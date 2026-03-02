FROM oven/bun:1 AS base
WORKDIR /app

RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npx playwright install --with-deps chromium && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb* package-lock.json* ./
RUN bun install --ignore-scripts

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "api.ts"]
