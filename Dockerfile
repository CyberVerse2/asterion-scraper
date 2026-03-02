FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb* package-lock.json* ./
RUN bun install

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "bun run scraper.ts & bun run api.ts"]
