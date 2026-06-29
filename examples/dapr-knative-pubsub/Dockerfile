FROM oven/bun:1.2.17-alpine

WORKDIR /app

COPY --chown=bun:bun package.json tsconfig.json ./
COPY --chown=bun:bun src ./src

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER bun

CMD ["bun", "src/server.ts"]
