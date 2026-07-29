# Made Up Video

Made Up Video is a fictional independent physical-video-rental shop and the
inherited application for **Advanced Monorepos: Evolve a Production TypeScript
App with Nx**.

This checkpoint is intentionally one standalone Next.js App Router application.
It supports browsing six original films, viewing title details, renting an
available physical copy as member Jamie Vega, viewing active rentals, and
returning a copy.

## Required tools

- Node.js `24.18.0`
- pnpm `11.17.0`
- A developer-provided PostgreSQL database

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

## Local setup

Install the committed dependencies:

```sh
pnpm install --frozen-lockfile
```

Copy the example environment file:

```sh
cp .env.example .env
```

Create the `madeup_video` database in your own PostgreSQL service and update
`DATABASE_URL` in `.env` if its host, port, database name, or credentials differ
from the example.

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

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

The Prisma client under `generated/prisma/`, local environment files, framework
output, and installed dependencies are ignored.

## Environment checkpoint boundary

PostgreSQL is developer-provided at this checkpoint. A reproducible Compose
workflow is intentionally introduced in a later course lesson; this repository
does not include `compose.yaml` yet.

## Toolchain decision

See [ADR 0001](docs/decisions/0001-toolchain-versions.md) for the selected
versions, compatibility analysis, and official sources.
