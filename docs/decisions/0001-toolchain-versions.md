# ADR 0001: Toolchain versions

- Status: Accepted
- Decision date: 2026-07-28
- Last verified: 2026-07-28

## Context

The course project will evolve from a standalone Next.js application into an Nx monorepo with a Next.js storefront, NestJS API, Prisma, Vitest, and Playwright. Developers and CI therefore need one Node.js and pnpm policy that is inside the supported range of every intended tool.

The repository must not assume that Corepack is bundled with Node.js. Node.js documents Corepack as experimental and states that it is no longer distributed beginning with Node.js 25.

## Decision

Use these exact repository tool versions:

| Tool | Selected version | Repository declaration |
| --- | --- | --- |
| Node.js | `24.18.0` | `.tool-versions` and `engines.node` |
| pnpm | `11.17.0` | `packageManager` and `engines.pnpm` |

`.npmrc` enables strict engine checking. A contributor whose active Node.js or pnpm version differs from the manifest receives an installation error rather than a warning.

Install pnpm explicitly with npm:

```sh
npm install --global pnpm@11.17.0
```

The `packageManager` field remains useful to tools that understand it, but the setup path does not depend on Corepack.

## Compatibility baseline

The following exact releases were current stable releases consulted when this decision was verified. They are the approved compatibility baseline for later production-plan tasks, but they are not installed by this ADR.

| Intended tool | Version reviewed | Node.js requirement or support statement | Conclusion for Node.js `24.18.0` |
| --- | --- | --- | --- |
| pnpm | `11.17.0` | pnpm 11 requires Node.js 22 or later; its compatibility table includes Node.js 24 | Supported |
| Nx | `23.1.0` | Nx 23 supports Node.js 26, 24, and `^22.12.0` | Supported |
| Next.js | `16.2.9` | Node.js `>=20.9.0` | Supported |
| NestJS | `11.1.28` | NestJS 11 requires Node.js 20 or later and recommends the latest LTS | Supported |
| Prisma ORM | `7.7.0` | Node.js `^20.19.0`, `^22.12.0`, or `^24.0.0`; Active and Maintenance LTS lines are tested | Supported |
| Vitest | `4.1.7` | Node.js `>=22.12.0` | Supported |
| Playwright | `1.62.0` | Current documentation supports the latest Node.js 22, 24, or 26 | Supported |

Node.js `24.18.0` was selected because it was the latest patch of the supported Node.js 24 LTS line on the verification date. Node.js 26 was still Current rather than LTS. Node.js 22 was also LTS, but Node.js 24 provides the longer remaining support runway while remaining in every intended tool's documented range.

The planned Nx integrations also overlap with the reviewed framework releases: `@nx/next` supports Next.js `>=15 <17`, `@nx/nest` supports NestJS 10 or 11, `@nx/vitest` supports Vitest 3 or 4, and `@nx/playwright` supports Playwright `^1.36.0`. Nx packages and `@nx/*` plugins must use the same exact version when they are introduced.

## Official sources

- Node.js release status and exact LTS patch: [Node.js releases](https://nodejs.org/en/about/previous-releases) and [Node.js v24 archive](https://nodejs.org/en/download/archive/v24)
- Node.js Corepack distribution status: [Node.js Corepack documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/corepack.html)
- pnpm installation, Node.js compatibility, and npm installation path: [pnpm installation](https://pnpm.io/installation)
- pnpm exact release: [pnpm v11.17.0 release](https://github.com/pnpm/pnpm/releases/tag/v11.17.0)
- Nx Node.js compatibility matrix: [Nx with Node.js](https://nx.dev/docs/technologies/node/introduction)
- Nx exact release line: [Nx 23.1 release](https://nx.dev/blog/nx-23-1-release)
- Nx integration compatibility: [Next.js](https://nx.dev/docs/technologies/react/next/introduction), [NestJS](https://nx.dev/docs/technologies/node/nest/introduction), [Vitest](https://nx.dev/docs/technologies/test-tools/vitest/introduction), and [Playwright](https://nx.dev/docs/technologies/test-tools/playwright/introduction)
- Next.js minimum Node.js version: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- Next.js exact package metadata: [Next.js 16.2.9 package manifest](https://github.com/vercel/next.js/blob/v16.2.9/packages/next/package.json)
- NestJS Node.js requirement: [NestJS first steps](https://docs.nestjs.com/first-steps) and [NestJS 11 migration guide](https://docs.nestjs.com/migration-guide)
- NestJS exact release: [NestJS releases](https://github.com/nestjs/nest/releases)
- Prisma runtime requirements: [Prisma system requirements](https://www.prisma.io/docs/orm/reference/system-requirements)
- Prisma exact release: [Prisma changelog](https://www.prisma.io/changelog)
- Vitest runtime requirement and exact release: [Vitest repository](https://github.com/vitest-dev/vitest) and [Vitest v4.1.7 release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.7)
- Playwright runtime requirement and exact release: [Playwright installation](https://playwright.dev/docs/intro) and [Playwright release notes](https://playwright.dev/docs/release-notes)

## Consequences

- Developers and CI use the same exact Node.js and pnpm versions.
- Frozen installation is reproducible from `pnpm-lock.yaml`.
- A version manager may read `.tool-versions`, but asdf, mise, or any other manager remains optional.
- Framework packages are deliberately absent until their production-plan tasks.
- Future version changes require updating this ADR, every repository declaration, regenerating the lockfile with the selected pnpm version, and rerunning the complete compatibility verification.
