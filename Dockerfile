# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Lockfile is out of date with npm 10+ nested ajv copies.
# Install (not ci) so the image still builds; lock will be refreshed later.
RUN npm install --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
ENV NITRO_PRESET=node-server
ENV DATABASE_URL=
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    NITRO_PORT=8080 \
    NITRO_HOST=0.0.0.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.output ./.output
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://127.0.0.1:8080/ >/dev/null || exit 1
USER node
CMD ["node", ".output/server/index.mjs"]
