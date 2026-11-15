import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const prefix = '/api/google-calendar';
const origin = 'https://its-your-time-now-v2.up.railway.app';
const callback = origin + prefix + '/callback';
const googleApi = 'https://www.googleapis.com/calendar/v3';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
const scopes = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
const sessionName = '__Secure-iytn-google-session';
const flowName = '__Secure-iytn-google-flow';
const sessionDuration = 30 * 24 * 60 * 60;
const minute = 60_000;
const meridian = /^☯\s*(?:желчный пузырь|печень|л[её]гкие|толстый кишечник|желудок|селез[её]нка|сердце|тонкий кишечник|мочевой пузырь|почки|перикард|тройной обогреватель)\s*$/iu;

class CalendarError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function readCookie(request, name) {
  return (request.headers.get('cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
}

function makeCookie(name, value, age) {
  return `${name}=${value}; Path=${prefix}; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
}

function seal(value, secret, name) {
  const key = createHash('sha256').update('iytn/calendar/cookies/v1\0').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name));
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function unseal(request, secret, name) {
  try {
    const value = readCookie(request, name);
    if (!value || value.length > 4000) return null;
    const bytes = Buffer.from(value, 'base64url');
    const key = createHash('sha256').update('iytn/calendar/cookies/v1\0').update(secret).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const body = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const data = JSON.parse(body.toString('utf8'));
    return data.expires > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function redirect(location, cookies = []) {
  const headers = new Headers({ ...noStore, location });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function sameState(left, right) {
  if (!left || !right || left.length !== right.length || left.length !== 43) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function exchange(values, config) {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams({ ...values, client_id: config.id, client_secret: config.secret }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || typeof result.access_token !== 'string') {
    const reconnect = result.error === 'invalid_grant';
    throw new CalendarError(reconnect ? 'Подключите Google Календарь заново.' : 'Google Календарь временно недоступен.', reconnect ? 401 : 502);
  }
  return result;
}

async function googleGet(access, path, query) {
  const url = new URL(googleApi + path);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    headers: { authorization: 'Bearer ' + access },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const auth = response.status === 401;
    throw new CalendarError(auth ? 'Подключите Google Календарь заново.' : 'Не удалось получить выбранные календари Google.', auth ? 401 : 502);
  }
  return response.json();
}

async function googleItems(access, path, query) {
  const result = [];
  let pageToken;
  const pages = new Set();
  do {
    const page = await googleGet(access, path, pageToken ? { ...query, pageToken } : query);
    result.push(...(page.items || []));
    pageToken = page.nextPageToken;
    if (result.length > 5000 || (pageToken && (pages.has(pageToken) || pages.size >= 25))) {
      throw new CalendarError('Слишком много записей для сверки.', 502);
    }
    if (pageToken) pages.add(pageToken);
  } while (pageToken);
  return result;
}

export function dayBounds(date, zone) {
  const stamp = Date.parse(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== date) throw new CalendarError('Некорректная дата.', 400);
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    throw new CalendarError('Некорректный часовой пояс.', 400);
  }
  function midnight(utc) {
    const day = new Date(utc).toISOString().slice(0, 10);
    let lower = utc - 36 * 60 * minute;
    let upper = utc + 36 * 60 * minute;
    while (upper - lower > 1000) {
      const middle = Math.floor((lower + upper) / 2000) * 1000;
      if (formatter.format(new Date(middle)) < day) lower = middle;
      else upper = middle;
    }
    return upper;
  }
  return { start: midnight(stamp), end: midnight(stamp + 24 * 60 * minute) };
}

export function busyIntervals(events, bounds, date) {
  const intervals = [];
  for (const event of events) {
    if (event.status === 'cancelled' || event.transparency === 'transparent' ||
        event.eventType === 'workingLocation' ||
        event.attendees?.some(person => person.self && person.responseStatus === 'declined')) continue;
    const allDay = typeof event.start?.date === 'string' && typeof event.end?.date === 'string';
    if (allDay && !(event.start.date <= date && event.end.date > date)) continue;
    const start = allDay ? bounds.start : Math.max(bounds.start, Date.parse(event.start?.dateTime));
    const end = allDay ? bounds.end : Math.min(bounds.end, Date.parse(event.end?.dateTime));
    if (!(end > start)) continue;
    intervals.push({
      start, end, allDay,
      reference: !allDay && Boolean(event.recurringEventId) && meridian.test(event.summary || ''),
    });
  }
  return intervals.sort((a, b) => a.start - b.start || a.end - b.end);
}

export async function googleCalendarRoute(request, url, config) {
  const json = (data, status = 200, cookies = []) => {
    const headers = new Headers(noStore);
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return Response.json(data, { status, headers });
  };
  const route = url.pathname.slice(prefix.length);
  const method = request.method;
  const configured = Boolean(config.id && config.secret);
  const session = configured ? unseal(request, config.secret, sessionName) : null;
  if (route === '/status' && method === 'GET') return json({ configured, connected: Boolean(session) });
  if (!configured) return json({ error: 'Подключение Google Календаря ещё не настроено.' }, 503);
  if (method === 'POST' && request.headers.get('origin') !== origin) return json({ error: 'Запрос отклонён.' }, 403);
  try {
    if (route === '/connect' && method === 'POST') {
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: config.id, redirect_uri: callback, response_type: 'code', scope: scopes.join(' '),
        state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
      }).toString();
      const flow = seal({ state, verifier, expires: Date.now() + 10 * minute }, config.secret, flowName);
      return redirect(auth.toString(), [makeCookie(flowName, flow, 600)]);
    }
    if (route === '/callback' && method === 'GET') {
      const clearFlow = makeCookie(flowName, '', 0);
      const flow = unseal(request, config.secret, flowName);
      const code = url.searchParams.get('code');
      if (!code || !sameState(url.searchParams.get('state'), flow?.state)) {
        return redirect(origin + '/?googleCalendar=error', [clearFlow]);
      }
      try {
        const token = await exchange({ code, code_verifier: flow.verifier, redirect_uri: callback, grant_type: 'authorization_code' }, config);
        if (!token.refresh_token || (token.scope && !scopes.every(scope => token.scope.split(' ').includes(scope)))) {
          return redirect(origin + '/?googleCalendar=error', [clearFlow]);
        }
        const expires = Date.now() + sessionDuration * 1000;
        const value = seal({ refresh: token.refresh_token, access: token.access_token, accessUntil: Date.now() + Number(token.expires_in) * 1000, expires }, config.secret, sessionName);
        return redirect(origin + '/?googleCalendar=connected', [clearFlow, makeCookie(sessionName, value, sessionDuration)]);
      } catch {
        return redirect(origin + '/?googleCalendar=error', [clearFlow]);
      }
    }
    if (route === '/disconnect' && method === 'POST') return json({ connected: false }, 200, [makeCookie(sessionName, '', 0)]);
    if (!['/calendars', '/day'].includes(route) || method !== 'GET') return json({ error: 'Маршрут не найден.' }, 404);
    if (!session) return json({ error: 'Сначала подключите Google Календарь.' }, 401);
    let access = session.access;
    const cookies = [];
    if (!access || session.accessUntil < Date.now() + minute) {
      const token = await exchange({ refresh_token: session.refresh, grant_type: 'refresh_token' }, config);
      access = token.access_token;
      cookies.push(makeCookie(sessionName, seal({ ...session, access, accessUntil: Date.now() + Number(token.expires_in) * 1000, refresh: token.refresh_token || session.refresh }, config.secret, sessionName), Math.max(0, Math.floor((session.expires - Date.now()) / 1000))));
    }
    if (route === '/calendars') {
      const calendars = await googleItems(access, '/users/me/calendarList', { maxResults: '250', minAccessRole: 'reader' });
      return json({ calendars: calendars.map(cal => ({ id: cal.id, name: cal.summaryOverride || cal.summary || 'Календарь Google', primary: Boolean(cal.primary) })) }, 200, cookies);
    }
    const date = url.searchParams.get('date') || '';
    const zone = url.searchParams.get('tz') || 'UTC';
    const ids = [...new Set(url.searchParams.getAll('calendar'))];
    if (ids.length > 12 || ids.some(id => !id || id.length > 320)) throw new CalendarError('Выберите до 12 календарей.', 400);
    const bounds = dayBounds(date, zone);
    if (bounds.start === bounds.end) return json({ ...bounds, intervals: [] }, 200, cookies);
    const query = {
      timeMin: new Date(bounds.start).toISOString(), timeMax: new Date(bounds.end).toISOString(),
      timeZone: zone, singleEvents: 'true', showDeleted: 'false', maxResults: '250',
      fields: 'nextPageToken,items(start,end,summary,eventType,status,transparency,recurringEventId,attendees(self,responseStatus))',
    };
    const results = await Promise.all(ids.map(id => googleItems(access, '/calendars/' + encodeURIComponent(id) + '/events', query)));
    return json({ ...bounds, intervals: busyIntervals(results.flat(), bounds, date) }, 200, cookies);
  } catch (error) {
    const cookies = error.status === 401 ? [makeCookie(sessionName, '', 0)] : [];
    return json({ error: error instanceof CalendarError ? error.message : 'Google Календарь временно недоступен.' }, error instanceof CalendarError ? error.status : 502, cookies);
  }
}
