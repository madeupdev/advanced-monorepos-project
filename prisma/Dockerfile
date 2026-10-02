FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=384 PNPM_MAX_WORKERS=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY prisma/artifact/package.json prisma/artifact/pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --network-concurrency=2 --child-concurrency=1
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
ARG SOURCE_COMMIT
ARG BUILD_TIME
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT \
      org.opencontainers.image.created=$BUILD_TIME \
      org.opencontainers.image.source="https://github.com/madeupdev/advanced-monorepos-project" \
      course.toolchain="node24.18.0-pnpm11.17.0" \
      course.artifact="migrations"
USER node
ENTRYPOINT ["pnpm", "exec", "prisma", "migrate", "deploy"]
