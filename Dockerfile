FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb* package-lock.json* ./
RUN bun install --ignore-scripts

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "api.ts"]
