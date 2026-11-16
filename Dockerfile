FROM oven/bun:1.2.23
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY index.ts planner-engine.ts planner.js planner-qa.js planner.css google-calendar.js ./
RUN bun build ./planner.js ./planner-qa.js --target browser --outdir /tmp/planner-check
RUN bun build ./index.ts --target bun --packages external --outdir /tmp/server-check
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
