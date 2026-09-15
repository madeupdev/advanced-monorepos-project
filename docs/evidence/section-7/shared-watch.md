# Shared local-development watch evidence

Date: 2026-09-07. Runtime: Node.js 24.18.0, pnpm 11.17.0, and the
workspace-installed Nx 23.1.1. This evidence belongs to
`S07-L02-task-dependencies`; it does not exercise the lifecycle supervisor or
configuration validation introduced by later transitions.

## Task graph

The graph-only command was:

```sh
corepack pnpm exec nx run-many \
  --target=dev \
  --projects=@madeup-video/storefront,@madeup-video/admin \
  --graph=<temporary-file>
```

The exported task graph contained one `@madeup-video/api:dev:development` task.
Both `@madeup-video/storefront:dev` and `@madeup-video/admin:dev` listed that
same task ID in `continuousDependencies`, and the API task had
`continuous: true`. The API's existing finite `build` prerequisite also
appeared. No PostgreSQL or database project appeared in the selected task
graph. The automated assertion is in
`tests/tooling/architecture-projects.test.mjs`.

The frontend project files use explicit object-form dependencies:

```json
{
  "projects": ["@madeup-video/api"],
  "target": "dev"
}
```

The launcher selects one frontend for a focused profile or both frontends for
`full`; Nx supplies and deduplicates the API. The `api` profile remains
available for API-only work. PostgreSQL remains an independently managed local
prerequisite: `corepack pnpm db:status` reported the existing PostgreSQL 17
container healthy before the rehearsal, and no database lifecycle command was
added to a `dev` dependency.

## Admin and API

The admin rehearsal used disposable ports 43120 (API) and 43121 (admin). Nx
reported that the admin target had two prerequisites, ran the existing finite
API build, then kept these tasks alive together:

```text
@madeup-video/api:dev:development
@madeup-video/admin:dev --port=43121
```

The Nest application listened at `http://127.0.0.1:43120/api` and Vite listened
at `http://127.0.0.1:43121/`. A headless browser first observed the existing
`Made Up Video` wordmark. While both tasks remained running, the prepared
fixture `libs/ui/src/lib/brand-logo.tsx` changed the wordmark to
`Made Up Video watch proof`. Vite logged an HMR update for that exact shared UI
source and the already-open page observed the new text. No build command ran
after the source change. The fixture was restored and Vite logged the reverse
HMR update.

One interrupt was sent to the Nx command. After it exited, both 43120 and 43121
accepted no listener in `lsof`; no secondary process cleanup was needed.

## Storefront and API

The storefront rehearsal used disposable ports 43130 (API) and 43131
(storefront). Nx selected the storefront plus the same API dependency. Nest
listened at `http://127.0.0.1:43130/api`; Next reported ready at
`http://localhost:43131`.

The first browser observation used `127.0.0.1` for the Next page. Next compiled
the shared UI change but deliberately blocked its HMR resource as a cross-origin
development request and printed its `allowedDevOrigins` guidance. This was not
counted as a passing watch observation. The fixture was restored, and the
browser rehearsal was repeated through the server's displayed and configured
`localhost` origin.

On the corrected run, the already-open page first showed `Made Up Video`. The
same shared UI fixture was changed to `Made Up Video watch proof`; Next logged a
26 ms compilation and the open page observed the updated wordmark without a
restart or explicit build. The fixture was restored and Next logged a 19 ms
compilation.

One interrupt was sent to the Nx command. After it exited, both 43130 and 43131
accepted no listener in `lsof`; no secondary process cleanup was needed.

## Scope and limits

This rehearsal proves Nx 23.1.1 task selection, API deduplication, concurrent
frontend/API execution, shared UI watch updates, fixture restoration, and clean
interrupt behavior on this macOS host. It does not prove API source restart
behavior while `NX_DAEMON=false`, production readiness-loss propagation,
Windows process-tree cleanup, or final configuration-boundary behavior. Those
are separate gates.
