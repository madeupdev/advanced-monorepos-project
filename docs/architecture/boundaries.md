# Workspace boundaries

The storefront remains the root application. Workspace projects exist only
when they carry an ownership, runtime, dependency, public-contract, or useful
task boundary.

| Project | Responsibility | Why it is a project |
| --- | --- | --- |
| storefront | Next.js pages, routes, and storefront-only components | Deployable application |
| contracts | Runtime request schemas and API-facing rental types | Public compatibility boundary |
| rental-domain | Framework-neutral rental decisions | Isolated business-rule boundary |
| database | Prisma access and persistence operations | Server-only runtime boundary |
| ui | Modest reusable visual primitives | Shared visual ownership boundary |
| testing | Reusable fixtures and test support | Test-only dependency boundary |

This is the complete approved library set. A candidate must add a meaningful
boundary, not merely provide another folder name.

## Tag dimensions

Every project will be classified independently by:

- purpose: application, contract, domain, data access, UI, or testing;
- runtime: browser, server, or universal; and
- scope: storefront, rental, or shared.

These names are conventions for this workspace. They are not universal Nx
standards. Their value comes from the dependency decisions they encode.

## Allowed directions

Every dependency must satisfy all three tag dimensions:

| Source | Allowed target purposes |
| --- | --- |
| application | contract, domain, data access, UI |
| contract | contract |
| domain | contract, domain |
| data access | contract, domain, data access |
| UI | contract, UI |
| testing | application, contract, domain, data access, UI, testing |

Browser projects may depend only on browser or universal projects. Server
projects may depend only on server or universal projects. The universal
storefront temporarily contains both server routes and browser consumers, so
it may use all three runtimes until the dedicated API extraction.

Storefront scope may consume storefront, rental, and shared code. Rental scope
may consume rental and shared code. Shared scope may consume only shared code.

The root test files belong to the storefront project in the current layout.
Their lint override permits `@madeup-video/testing`; application source does
not receive that exception. Production code therefore cannot depend on test
fixtures.

The database adapter has one exact-file allowance for its generated Prisma
client at `generated/prisma/client`. Generated Prisma output is not an Nx
project or a handwritten architectural dependency, and its established output
contract remains unchanged. The allowance applies to no other source file or
import.

## Public entry points

Each library exposes one `src/index.ts`. Consumers import that public entry
point through its `@madeup-video/*` alias rather than reaching into internal
files. Internal modules remain free to change without expanding the public
contract. `tsconfig.base.json` owns the five aliases so Nx and TypeScript read
the same public-entry-point map.

Accepted:

```ts
import type { TitleSummary } from "@madeup-video/contracts";
```

Rejected:

```ts
import { getDatabase } from "@madeup-video/database"; // from browser UI
import { getDatabase } from "../libs/database/src/lib/database"; // deep import
```

Run `pnpm lint` for the repository-wide boundary check or pass a focused file
to `pnpm exec eslint` while diagnosing an edge.

## Rejected candidates

`PosterArt` is not a sixth project. It shares ownership, runtime, release
cadence, and task execution with `ui`, so extracting it would create navigation
cost without a new enforceable boundary. It remains a module inside `ui`.

The same test rejects both extremes: do not place unrelated code in a generic
shared library, and do not create one library per folder when ownership,
runtime, dependencies, and task execution remain identical.
