FROM oven/bun:1.3.14-debian AS bun

FROM python:3.12-bookworm

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN groupadd --gid 1000 bun && useradd --uid 1000 --gid bun --create-home bun

WORKDIR /app/controller

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY contracts ./contracts
COPY src ./src

ENV NODE_ENV=production

EXPOSE 8080

USER bun

CMD ["bun", "src/main.ts"]
