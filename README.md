# Made Up Video

Made Up Video is a fictional independent physical-video-rental shop and the
inherited application for **Advanced Monorepos: Evolve a Production TypeScript
App with Nx**.

This state is intentionally one standalone Next.js App Router application. It
supports browsing six original films, viewing title details, renting an
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
lives in `pnpm-workspace.yaml`. asdf and mise are optional ways to activate the
declared versions; neither is required.

Confirm that Docker is running:

```sh
docker version
```

Then confirm either supported Compose v2 form. Use the plugin form when it is
available:

```sh
docker compose version
```

If that command is unavailable, use the standalone v2 form:

```sh
docker-compose version
```

Repository-owned database commands detect either form. Docker installation and
administration are outside this project's scope.

## Local ownership boundary

Docker Compose owns one external-infrastructure process: PostgreSQL 17. The
storefront, Prisma commands, tests, and seed process remain repository-owned
Node.js processes. PostgreSQL therefore starts and stops independently from
`pnpm dev`; restarting the storefront does not recreate the database.

Compose creates one named data volume, `madeup-video_postgres-data`. The
credentials in `compose.yaml` and the committed environment examples are
non-secret local-development values. Do not reuse them for a deployed
environment.

Repository commands pin the absolute committed `compose.yaml`, project
directory, and validated `madeup-video` project identity. Compose variables in
`.env` or the process environment, plus automatic override files, cannot
redirect those commands. Controlled isolated verification can select a
namespaced identity through `COURSE_COMPOSE_PROJECT_NAME`; `POSTGRES_PORT`
remains the supported local override.

## Local setup

From a clean checkout, run the complete setup:

```sh
pnpm run setup
```

Setup validates Node, pnpm, Docker, the Docker daemon, Compose v2, and the local
database URLs. It preserves existing `.env` and `.env.test` files, copies the
committed examples only when either file is absent, installs the frozen
dependency graph, starts PostgreSQL, and waits for it to become healthy. It
then ensures that both `madeup_video` and `madeup_video_test` exist and
generates the Prisma client. It applies committed migrations to the development
database and loads its deterministic fixtures.

Setup is idempotent and does not start the persistent Next.js development
process. Start the storefront separately:

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The deterministic seed contains six titles, fifteen physical copies, and no
rentals.

## Focused database commands

Use the narrowest command that matches the job:

```sh
pnpm run db:check
pnpm run db:config
pnpm run db:start
pnpm run db:status
pnpm run db:logs
pnpm run db:stop
pnpm run db:migrate
pnpm run db:seed
```

`db:check` reports both course databases and deterministic seed counts without
requiring a Compose command form. `db:config` validates and displays the pinned
PostgreSQL-only Compose configuration through whichever Compose v2 form is
installed. `db:status` shows the PostgreSQL service state, and `db:logs`
displays its fifty most recent log lines.

`db:start` starts PostgreSQL and waits for readiness. Running it again is safe.
`db:stop` stops only the PostgreSQL service and preserves
`madeup-video_postgres-data`. `db:migrate` applies the migrations already
committed to `prisma/migrations/`. `db:seed` deterministically restores the six
titles and fifteen copies and clears rental data.

Reset is deliberately separate and visibly destructive:

```sh
pnpm run db:reset -- --yes
```

The command refuses to run without `--yes`. Before mutation it validates the
toolchain, local database configuration, pinned Compose definition, and exact
volume ownership labels. Only after preflight succeeds does it remove
`madeup-video_postgres-data`, recreate PostgreSQL, apply the committed
migrations, and reseed the development database. It does not derive the
deletion target from `DATABASE_URL`, scan for arbitrary Docker volumes, or
affect unrelated containers and volumes.

## Verification commands

Setup creates the dedicated `madeup_video_test` database without preparing its
schema or fixtures. The integration and end-to-end harnesses apply committed
migrations and prepare that database when those tests run. The harness
continues to reject missing, malformed, non-test, and normal development URLs
before it can reset data.

Application setup and browser-test setup are deliberately separate. On macOS
and Windows, install the one browser used by the inherited end-to-end journey
once:

```sh
pnpm exec playwright install chromium
```

On Linux and WSL, install Chromium with its required system dependencies:

```sh
pnpm exec playwright install --with-deps chromium
```

`pnpm test:all` requires this browser installation. The focused Section 2
environment checks—`pnpm run db:config`, `pnpm run db:status`,
`pnpm run db:check`, and `pnpm test:tooling`—do not require Playwright setup.

Run individual checks or the complete test suite:

```sh
pnpm lint
pnpm typecheck
pnpm test:tooling
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

## Setup recovery

- **Docker executable missing:** Install Docker with Compose v2 and rerun
  `pnpm run setup`.
- **Docker daemon unavailable:** Start Docker, confirm `docker version` shows a
  server, and rerun the command.
- **Compose unavailable:** Enable the Compose v2 plugin or provide the
  standalone Compose v2 command.
- **Missing environment file:** Rerun `pnpm run setup`; an existing file is
  never overwritten.
- **Invalid database URL:** Compare `.env` with `.env.example` and `.env.test`
  with `.env.test.example`. Keep the exact course database names and separate
  the development and test databases.
- **Port 5432 already in use:** In `.env`, set `POSTGRES_PORT` to an available
  port and update `DATABASE_URL` to match. In `.env.test`, update
  `TEST_DATABASE_URL` to that same port. This works in POSIX shells,
  PowerShell, and Command Prompt without a shell-specific environment command.
  Do not stop an unrelated database merely to free the port.
- **PostgreSQL does not become healthy:** The readiness error includes recent
  PostgreSQL logs. Run `pnpm run db:logs` for a fresh view, correct the reported
  startup problem, and rerun `pnpm run db:start`.

The root commands use Node.js built-ins and argument arrays rather than
shell-specific interpolation, so the same workflow applies in macOS and Linux
terminals, Windows PowerShell, and WSL where Node, pnpm, Docker, and Compose v2
are available.

## Continuous integration

The inherited baseline CI runs frozen installation, lint, type-checking, unit
tests, API integration tests, a production build, and the Chromium end-to-end
journey as separate visible steps. It continues to use a PostgreSQL 17 GitHub
Actions service rather than Compose and keeps the `madeup_video`
development/build database separate from the guarded `madeup_video_test` test
database.

When Playwright fails, its screenshots and traces are available from the
workflow run as the short-lived `playwright-failure-evidence` artifact. This is
deliberately the pre-Nx baseline; affected execution, Nx caching, and
dependency-aware CI arrive in later lessons.

## Toolchain decision

See [ADR 0001](docs/decisions/0001-toolchain-versions.md) for the selected
versions, compatibility analysis, and official sources.

## License

This software is available for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md).

Required Notice: Copyright 2026 Robert Donnelly.
