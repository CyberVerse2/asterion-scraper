FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb* package-lock.json* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "api.ts"]
