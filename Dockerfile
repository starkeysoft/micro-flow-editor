# Build the Vue client, then ship only what the server needs.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim
ENV NODE_ENV=production \
    PORT=8090 \
    SQLITE_PATH=/app/data/micro-flow-editor.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/bin ./bin
COPY --from=build /app/lib ./lib
COPY --from=build /app/runtime ./runtime
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8090
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/meta').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/index.js"]
