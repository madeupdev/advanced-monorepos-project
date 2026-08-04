# Made Up Video

Made Up Video is a fictional independent physical-video-rental shop and the
inherited application for **Advanced Monorepos: Evolve a Production TypeScript
App with Nx**.

This state is intentionally one standalone Next.js App Router application.
It supports browsing six original films, viewing title details, renting an
available physical copy as member Jamie Vega, viewing active rentals, and
returning a copy.

## Required tools

- Node.js `24.18.0`
- pnpm `11.17.0`
- Docker with Docker Compose v2

Install Node.js from the [official Node.js download page](https://nodejs.org/en/download)
or with a version manager of your choice. Install the exact pnpm release without
relying on bundled Corepack:

```sh
npm install --global pnpm@11.17.0
```

Confirm the active versions:

```sh
node --version
pnpm --version
```

The output must be `v24.18.0` and `11.17.0`. Repository-level pnpm enforcement
lives in `pnpm-workspace.yaml`.

Confirm that Docker is running and that either supported Compose v2 form is
available:

```sh
docker version
docker compose version
```

If the Compose plugin form is unavailable, use standalone Compose v2:

```sh
docker-compose version
```

## Local setup

Install the committed dependencies:

```sh
pnpm install --frozen-lockfile
```

Copy the example environment file:

```sh
cp .env.example .env
```

The committed Compose definition supplies PostgreSQL 17 on normal host port
`5432`. Start only that external-infrastructure service with the Compose
plugin:

```sh
docker compose --project-name madeup-video --file compose.yaml --project-directory . up --detach postgres
```

Or use the standalone Compose v2 form:

```sh
docker-compose --project-name madeup-video --file compose.yaml --project-directory . up --detach postgres
```

If you change `POSTGRES_PORT` in `.env`, update `DATABASE_URL` to the same host
port before applying migrations.

Generate the Prisma client, apply the migration, and load the deterministic
fixtures:

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

The seed resets rental data and creates six titles with fifteen physical copies.

Start the storefront:

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification commands

Create a separate test database named `madeup_video_test`, copy
`.env.test.example` to `.env.test`, and adjust its connection details if
required. The test harness rejects missing, malformed, non-test, and normal
development-database URLs before it can reset data.

Install the one browser used by the inherited end-to-end journey:

```sh
pnpm exec playwright install chromium
```

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:all
pnpm build
```

Unit and integration tests are separate Vitest projects. Database-backed
integration files run sequentially against the dedicated test database. The
single Playwright journey starts its own Next.js server on port `3100`, uses one
Chromium worker with no retries, and resets the same test fixtures before it
runs.

The Prisma client under `generated/prisma/`, local environment files, framework
output, Playwright failure artifacts, and installed dependencies are ignored.

## Continuous integration

The inherited baseline CI runs frozen installation, lint, type-checking, unit
tests, API integration tests, a production build, and the Chromium end-to-end
journey as separate visible steps. It uses a PostgreSQL 17 service in GitHub
Actions rather than local Compose orchestration, and it keeps the
`madeup_video` development/build database separate from the guarded
`madeup_video_test` test database.

When Playwright fails, its screenshots and traces are available from the
workflow run as the short-lived `playwright-failure-evidence` artifact. This is
deliberately the pre-Nx baseline; affected execution, Nx caching, and
dependency-aware CI arrive in later lessons.

## Local ownership boundary

The committed `compose.yaml` contains only PostgreSQL 17; it does not contain
the storefront or another application service. PostgreSQL is independently
controlled external infrastructure, so restarting the repository-owned
Next.js process does not recreate the database. Compose publishes port `5432`
by default and preserves data in its named volume. Later project states add
focused repository commands around this boundary; this state uses the explicit
Compose v2 commands shown above.

## Toolchain decision

See [ADR 0001](docs/decisions/0001-toolchain-versions.md) for the selected
versions, compatibility analysis, and official sources.
