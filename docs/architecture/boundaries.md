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

The storefront may depend on the approved libraries while it remains the
temporary Next.js application and backend. Contracts and rental-domain code
must remain framework-neutral. Browser UI must not depend on server-only
database code. Production code must not depend on testing utilities, and
lower-level libraries must not reach into storefront internals.

The boundary implementation will make those decisions executable in the next
runnable state. This decision-only state does not claim that enforcement is
already active.

## Public entry points

Each library exposes one `src/index.ts`. Consumers import that public entry
point through its `@madeup-video/*` alias rather than reaching into internal
files. Internal modules remain free to change without expanding the public
contract.

## Rejected candidates

`PosterArt` is not a sixth project. It shares ownership, runtime, release
cadence, and task execution with `ui`, so extracting it would create navigation
cost without a new enforceable boundary. It remains a module inside `ui`.

The same test rejects both extremes: do not place unrelated code in a generic
shared library, and do not create one library per folder when ownership,
runtime, dependencies, and task execution remain identical.
