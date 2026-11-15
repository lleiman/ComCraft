FROM oven/bun:1.2.23
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY index.ts planner-engine.ts planner.js planner.css ./
RUN bun build ./planner.js --target browser --outdir /tmp/planner-check
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
