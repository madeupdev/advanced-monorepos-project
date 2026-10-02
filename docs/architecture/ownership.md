# Ownership and project introduction

The existing repository collaborator **@robdonn** owns review and maintenance of these boundaries. GitHub collaborator API verified this individual user has write access. The repository namespace is an organisation and cannot itself be named as a CODEOWNERS user; GitHub CODEOWNERS validation must also report zero errors. No teams are invented. `.github/CODEOWNERS` routes reviews when the file is present on the PR base branch; required owner approval depends on separately configured branch protection. This work does not configure or claim that enforcement.

| Nx project | Responsibility | Review owner |
| --- | --- | --- |
| @madeup-video/storefront | Next pages, server composition and browser-facing storefront | @robdonn |
| @madeup-video/admin | Vite inventory administration UI | @robdonn |
| @madeup-video/api | Nest HTTP contract and server composition | @robdonn |
| @madeup-video/api-e2e | Real HTTP API compatibility checks | @robdonn |
| @madeup-video/admin-e2e | Admin browser journey | @robdonn |
| @madeup-video/contracts | Runtime schemas and consumer compatibility | @robdonn |
| @madeup-video/rental-domain | Framework-neutral rental decisions | @robdonn |
| @madeup-video/database | Server-only persistence and Prisma adapter | @robdonn |
| @madeup-video/ui | Modest reusable visual primitives | @robdonn |
| @madeup-video/testing | Test fixtures and shared test support | @robdonn |
| @madeup-video/repository-tooling | Lifecycle, configuration, validation, generators and recovery checks | @robdonn |

Root tooling also owns `scripts`, `tools`, CI, Prisma schema/migrations and repository guidance. A named maintainer reviews contract/runtime changes, fixes failed verification and keeps the commands runnable. Ownership is responsibility for a decision, not permission to ignore other consumers.

## Decide before generating

Evaluate runtime, dependency boundary, public contract, ownership and independently useful task responsibility. Record the proposed consumer and evidence for each dimension.

- **Application:** a separately runnable/deployable executable with its own lifecycle, such as API. Do not disguise an HTTP process as a library.
- **Library:** a reusable boundary with a deliberate public contract and independently useful validation. Runtime alone can justify server-only persistence separation even with one consumer.
- **Internal module:** code that shares its parent's runtime, dependencies, owner, contract and validation responsibility. Keep it within that project.

**Accept conditionally:** a framework-neutral rental policy consumed by two independently deployed applications, with a stable decision contract and focused tests. Owner @robdonn; universal runtime; rental scope; contract/domain dependencies only. This is a proposed scenario, not approval to add a sixth permanent library. The generator demonstration is disposable.

**Reject:** extracting `PosterArt` into another project: it shares UI runtime, ownership, entry point and tests; keep it an internal UI module. Reject generic shared buckets and one library per folder. The five existing public libraries remain the approved architecture.

## Changes and verification

Import library `src/index.ts` through its root `@madeup-video/*` alias; never deep-import a consumer's internals. Inspect `pnpm exec nx graph --file=stdout`, run enforced `pnpm lint`, focused checks, then required global gates. Repository tooling and generated source do not become application runtime dependencies. CODEOWNERS last-match semantics matter; explicit paths and the fallback currently resolve to the same verified owner.

[GitHub CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
