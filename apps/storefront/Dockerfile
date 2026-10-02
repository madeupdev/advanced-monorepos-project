FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=384
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --network-concurrency=4 --child-concurrency=1
COPY . .
ENV TEST_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build_test NX_DAEMON=false NX_NO_CLOUD=true NX_PREFER_NODE_STRIP_TYPES=false NEXT_TELEMETRY_DISABLED=1
ARG API_ORIGIN=http://127.0.0.1:3333
ARG API_PORT=3333
ENV API_URL=$API_ORIGIN NEXT_PUBLIC_API_URL=$API_ORIGIN API_PORT=$API_PORT
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm exec nx run @madeup-video/storefront:build --skip-nx-cache
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=384
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/storefront/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=build --chown=node:node /app/apps/storefront/public ./apps/storefront/public
ARG SOURCE_COMMIT
ARG BUILD_TIME
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT \
      org.opencontainers.image.created=$BUILD_TIME \
      org.opencontainers.image.source="https://github.com/madeupdev/advanced-monorepos-project" \
      course.toolchain="node24.18.0-pnpm11.17.0" \
      course.artifact="storefront"
USER node
EXPOSE 3000
CMD ["node", "apps/storefront/server.js"]
