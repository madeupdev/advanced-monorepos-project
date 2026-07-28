# Advanced Monorepos Course Project

This repository is the runnable student project for **Advanced Monorepos: Evolve a Production TypeScript App with Nx**.

It currently contains only the repository toolchain policy. The application, framework dependencies, and Nx workspace are intentionally introduced in later course checkpoints.

## Required tools

- Node.js `24.18.0`
- pnpm `11.17.0`

Install Node.js from the [official Node.js download page](https://nodejs.org/en/download) or with a version manager of your choice. Then install the exact pnpm release without relying on bundled Corepack:

```sh
npm install --global pnpm@11.17.0
```

Confirm the active versions:

```sh
node --version
pnpm --version
```

The output must be `v24.18.0` and `11.17.0`.

Install the repository from its committed lockfile:

```sh
pnpm install --frozen-lockfile
```

No particular Node version manager is required. The committed `.tool-versions` file is available for tools that support it.

## Toolchain decision

See [ADR 0001](docs/decisions/0001-toolchain-versions.md) for the selected versions, compatibility analysis, and official sources.
