# CLAUDE.md

Start with [AGENTS.md](AGENTS.md) and the [LKC AI delivery operating model](docs/lkc-platform/AI-DELIVERY-OPERATING-MODEL.md). Claude 1 reviews CMS; Claude 2 reviews Portal/Product. Codex implements and fixes findings. ChatGPT provides BA, solution architecture and cross-team decisions; a complete task contract/checkpoint is sufficient for review without another ChatGPT-authored prompt.

## Independent review

Review the exact task allowlist, source branch/base/HEAD, working-tree diff and fingerprints. Keep source and assertions unchanged in review-only work; do not stage, commit, push or grant a shared slot. Tests, diff inspection and negative controls may run in isolated scratch environments with filtered/dummy configuration and separate outputs.

Return PASS/FAIL, finding IDs/severity/status, inspected revision and actual validation. Separate evidence you personally checked from author evidence or reports relayed by PO. A FAIL goes to Codex for scoped fixes and Claude regression; a PASS permits the authorized Codex publication workflow. Changes after review require evidence comparison and review of the affected delta. Never report a copied/mirrored reproduction as the original verified Git blob.

Apply A/B/C classification from governance. Lane-private work needs no per-task registry slot; shared paths still have one writer and an effective handoff. High-risk execution and unresolved business decisions keep their approval gates. Keep current CMS/Product slots and independent lanes intact.

## Commands and their boundaries

Read [package.json](package.json) and the relevant test/source files at the task ref before running commands. The repository has Node's test runner and Playwright; there is no fixed test-count baseline for every branch.

| Command | Purpose / boundary |
|---|---|
| `node --test tests/cms-article-draft-validation.test.mjs` | Example focused unit test; choose files for the actual delta. |
| `npm run test:unit` | Unit/action suite: `node --test tests/*.test.mjs`; report actual pass/fail/skip/cancelled and skip reasons. |
| `npm run lint` | ESLint; scoped lint is appropriate for small deltas. |
| `npx tsc --noEmit --incremental false` | TypeScript check with the correct generated client and isolated output. |
| `npx prisma validate` / `npx prisma generate` | Offline schema/client checks with dummy config; generation writes output, so isolate it. Neither proves DB compatibility. |
| `npm run build` | Next build plus `scripts/cms-media/assemble-standalone.mjs`; use filtered/dummy env and separate output when required by the task. |
| `npm run test:e2e:list` | Playwright discovery only, not browser execution PASS. |
| `npm run test:e2e:staging` / `npm run test:e2e:cleanup` | Guarded staging execution/cleanup; require separately authorized target, lease, ownership and runbook. Do not run to validate docs. |

On PowerShell use `npm.cmd`/`npx.cmd` if script execution policy blocks the .ps1 shims; do not change execution policy. Do not install dependencies, change Node or run a server just for a documentation review.

## Source architecture and current inventory

Next.js App Router pages delegate to feature modules in `src/features/`; shared contracts/infrastructure belong in `src/lib/`. Do not introduce cross-feature value imports; use an approved shared port/composition boundary. Preserve the Next.js agent rules and read the relevant installed Next guide before framework code changes.

At the G0 base `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`, feature directories are chart, cms, crm, landing and users. The old traders/upload/scoring inventory and stub claims do not describe this tree. Use the current task ref for later Product/CMS branches; an unmerged PR is not code already on main.

- [prisma/schema.prisma](prisma/schema.prisma) is the physical model inventory. [src/lib/roles.ts](src/lib/roles.ts) defines current permissions; [src/lib/auth.ts](src/lib/auth.ts) and [src/lib/authz.ts](src/lib/authz.ts) define auth boundaries. Do not rely on the obsolete ADMIN/MANAGER/TRADER role list.
- [prisma.config.ts](prisma.config.ts) supplies the datasource URL; schema uses the mysql provider and [src/lib/prisma.ts](src/lib/prisma.ts) uses PrismaMariaDb. Do not open .env or infer the MariaDB target version from provider/adapter names.
- [docs/cms/ROADMAP.md](docs/cms/ROADMAP.md) and [docs/cms/ACCEPTANCE.md](docs/cms/ACCEPTANCE.md) retain CMS history. Verify implementation/test status against source and evidence rather than treating historical checklists as current PASS.

## CI and production

[ci.yml](.github/workflows/ci.yml) currently validates pull requests targeting main, or workflow_dispatch with mode=validate. It configures Node 22, Prisma validate/generate, unit/action tests, lint, TypeScript and production build; inspect actual run/job logs before claiming any gate PASS. Dependency-base PRs need an authorized validate dispatch if no matching run exists. Never select the pinned cms009-candidate mode as replacement source CI.

[deploy.yml](.github/workflows/deploy.yml) triggers on push to main, including docs merges, and supports manual dispatch. Do not merge, deploy, apply a real migration, run production tests or bypass branch protection through review/publication authority. G0 changes neither workflow nor protection. Manual authenticated production UAT remains **DEFERRED**.
