# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Lockfile is out of date with npm 10+ nested ajv copies.
# Skip lifecycle scripts here — postinstall needs scripts/ which is not copied yet.
RUN npm install --ignore-scripts --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
ENV NITRO_PRESET=node-server
ENV DATABASE_URL=
RUN npm run build:ppocr && npm run build \
  && mkdir -p .output/server/_libs \
  && cp -f node_modules/@electric-sql/pglite/dist/pglite.data \
          node_modules/@electric-sql/pglite/dist/pglite.wasm \
          node_modules/@electric-sql/pglite/dist/initdb.wasm \
          .output/server/_libs/

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    NITRO_PORT=8080 \
    NITRO_HOST=0.0.0.0 \
    PGLITE_DATA_DIR=/data/pglite
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/pglite \
  && chown -R node:node /data /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://127.0.0.1:8080/ >/dev/null || exit 1
# Start as root so the entrypoint can chown a host-mounted /data, then gosu node.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
