FROM oven/bun:1.2.23
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY index.ts ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
