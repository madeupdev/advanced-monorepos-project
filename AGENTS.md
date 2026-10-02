# Contributor guidance

Read `docs/architecture/boundaries.md` when changing dependencies, `docs/architecture/ownership.md` before proposing projects, and `package.json` for current root commands.

- Applications: Next storefront, Vite admin, Nest API. API owns database access; browser code consumes public contracts. Prisma schema/migrations belong to root tooling. PostgreSQL is independently controllable through `pnpm db:*`.
- Public libraries: contracts, rental-domain, database, ui and testing. Import `@madeup-video/*` aliases from `src/index.ts`. Keep internal modules internal; preserve explicit runtime/type/scope boundaries and test-only import exceptions.
- Owner: @madeupdev; project metadata and `.github/CODEOWNERS` record responsibility. Required owner review depends on separately configured branch protection.
- Before a new project, justify runtime, dependency boundary, public contract, owner and independent task responsibility. The source-library generator supports only universal domain/contract libraries with rental/shared scope. Review generated code and add real behavior-specific tests before permanent adoption.
- Use pinned Node/pnpm in `.tool-versions` and `package.json`; install with `pnpm install --frozen-lockfile`. Configure separate test database via `.env.test.example`; graph inference evaluates test configuration.
- Inspect `pnpm exec nx show project <name> --json` and project graph before editing. `node scripts/workspace-conventions.mjs` checks metadata; `node scripts/team-demo.mjs library|drift|graph|cache` runs bounded disposable examples with source/cache cleanup.
- Run focused tests/typecheck first, then enforced `pnpm lint`. For integrated changes run `pnpm typecheck`, `pnpm test:all`, `pnpm build` with the dedicated test database and Chromium installed. CI range/selection policy retains global tooling and boundary checks. A skipped check is an evidence limit.
- Nx target inputs must cover external files, public build variables and dependency outputs. Diagnose cache results using task hashes, execution and output bytes. Avoid caching database/browser behavior. Release artifacts retain selection/provenance/credential rejection and expand/migrate/contract compatibility.
- Preserve existing tracked and untracked work. Keep task-owned fixtures, caches, databases, processes and ports isolated; clean only owned resources. Never include credentials in diagnostics. Report changed files, checks and remaining gates.

These instructions apply equally to engineers and optional coding agents. Agent products are not prerequisites.

# Cost-aware Codex routing

Use a dual-profile workflow to reduce development cost while preserving quality. Apply it by default in every project, subject to higher-priority instructions and available tools.

## Routing policy

- Treat the Codex desktop app and its OpenAI model as the paid brain: requirements, architecture, planning, ambiguous or high-risk decisions, difficult diagnosis, review, integration and final verification.
- Treat `codex exec --profile free` as the free hands. Prefer bounded, well-specified routine edits, scaffolding, mechanical migrations, test additions, formatting and straightforward documentation with objective acceptance checks.
- Choose the route per task. Keep work in the paid model when weak tool use, ambiguity, security risk or likely rework would cost more than it saves.
- Batch related mechanical work into one coherent free-profile task. Never include secrets in delegated prompts.
- Give runs a self-contained prompt with target directory, constraints, file paths and acceptance criteria. Normally use `codex exec --profile free -C <project> "<task>"`.
- Treat free output as untrusted: inspect the diff, run proportionate checks and resolve integration issues before completion.

## Creative work

- Route substantive creative authorship/editorial judgment to paid ChatGPT: voice, originality, pedagogy, narrative flow, examples, analogies, humour, persuasion and final polish, including course lessons, scripts, exercises and marketing copy.
- Use `gpt-5.6-sol` normally, `gpt-6-astra` for important, ambiguous, cross-document or demanding work, and `gpt-5.6-terra` for tightly constrained supporting editorial tasks. Preserve capability tiers as the catalog changes.
- Free models may only provide mechanical support on creative projects, such as formatting, organization, transcription cleanup or source extraction. A paid model reviews creative material before delivery.
- If ChatGPT capacity is unavailable, preserve work and request direction rather than substituting unsuitable free creative authorship.

## Exhaustion and fallback ladder

Preserve valid partial work and continue automatically after quota, rate limit, outage or capability failure:

1. Let `openrouter/free` choose another suitable free model, or pin another model verified as free with appropriate context/tool/coding ability. Never retry an exhausted model unchanged.
2. Use `opencode` or another configured zero-cost route when appropriate and independently verifiable.
3. After at most two failed free attempts for a blocked step, use the lowest-cost capable ChatGPT/OpenAI model without `--profile free`: normally `gpt-5.6-luna`, or `gpt-5.6-terra` for stronger reasoning/tool use. Check the current model catalog.
4. Escalate to `gpt-5.6-sol` or stronger only when cheaper capability cannot safely complete/verify it.

Switch without asking unless the fallback adds API charges outside the existing ChatGPT plan, weakens required capability or materially changes scope. Mention paid fallback in the handoff.

OpenRouter is zero-cost only. Use `openrouter/free` or model IDs explicitly verified as free; never select paid OpenRouter models or enable paid fallback. Treat a route as unavailable when zero-cost status cannot be verified.

## Configuration invariants

- `~/.codex/config.toml` is shared base: defines `[model_providers.openrouter]`, leaves `model_provider` unset so desktop retains OpenAI.
- `~/.codex/free.config.toml` is CLI overlay selected by `--profile free`: OpenRouter provider and verified free model.
- Keep OpenRouter `wire_api = "responses"` and configured shell authentication reading exported `OPENROUTER_API_KEY`.
- Avoid CLI `/model` with custom provider; pin a verified free model by editing overlay `model` when needed.
- Verify current free catalog/rate limits. Optimize total successful-task cost, including review/rework, rather than maximizing free use.
