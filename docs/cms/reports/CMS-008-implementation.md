# IMPLEMENTATION REPORT — CMS-008

Date: 2026-09-29 (UTC+7). Checkpoint: **LOCAL IMPLEMENTATION / VALIDATION PASS; handoff for Claude independent review**.

- Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`.
- Branch: `feature/cms-008-taxonomy-instruments`.
- Start/current HEAD: `85f9eb55e5c63217d060e89f71780959cb00058a`.
- Parent/base CMS-007: `9bd3ec8e7cc55ebcaf8a9782868a3ac93fcc7a34`.
- Preflight found a clean main checkout at the expected base. Fetched origin, verified the exact documentation commit and parent, then created the local tracking branch. No reset, stash, clean, discarded changes or implementation commit.
- Claude independent review **NOT RUN**; CI **NOT RUN**; browser/MariaDB/staging/real cleanup **NOT RUN**. CMS-008 **NOT COMPLETE / NOT DEPLOYED**.
- Manual authenticated UAT for CMS-005/006/007/008 remains **DEFERRED to project end by PO**, as recorded in [ACCEPTANCE](../ACCEPTANCE.md). It is neither PASS nor a blocker for this authorized implementation checkpoint.

## 1. Scope and implementation

Read the repository instructions, current schema/packages/auth/source, roadmap/acceptance/CMS-007 checkpoint and full [CMS-008 spec](../tasks/CMS-008.md) / [handoff](../tasks/CMS-008-IMPLEMENTATION.md). Read installed Next 16.2.6 guides for Server Actions, client boundaries, params/searchParams, navigation and revalidation before coding. Current source takes precedence over stale model/role/no-test-runner statements in CLAUDE.md; no example migration command was executed.

Two manual-save surfaces use the existing schema and permissions:

- `/creator/taxonomy`: ADMIN/SUPER_ADMIN with existing `cms:admin`, four static catalog kinds, bounded search/pagination, explicit create/edit/delete confirmation, immutable identity display and supported active flags.
- `/creator/articles/[id]/classification`: fresh scoped Article snapshot, category/topics/tags/instruments and optional primary selection. Read-only workflow states and unsupported documents still display safe selected metadata.

No schema, migration, dependency/pin/lockfile, role matrix, auth configuration, deploy workflow, market-data integration or CRM change. No inline citation/editor node, autosave payload or source payload change.

### Catalog identity, validation and writes

`taxonomy.ts` validates unknown inputs by exact own enumerable data descriptors before reading values. It rejects accessors, symbols, extras, undefined/coercible values and hostile object shapes without invoking getters/toJSON. Names/descriptions use the specified Unicode normalization/limits; slugs, booleans, integer sort order, IDs, query bounds and canonical millisecond tokens have separate checks. Safe error mapping reads only permitted data descriptors and never emits raw exceptions/SQL.

Instrument identity is generated server-side from normalized type/exchange/symbol: FX and CRYPTO reserved prefixes require null exchange; other types use `EXCHANGE:SYMBOL` or `SYMBOL` and reject those reserved exchange names. Duplicate canonical identity conflicts even across instrument types. Existing slug/tuple/key remain immutable, including legacy identities that do not meet new-create syntax. Metadata edits never rewrite identity or attached Article tokens. Tag has no invented active flag.

Catalog create/update/delete use static Prisma delegates inside Serializable transactions with a fresh ACTIVE/session-role/admin check. Update/delete use the catalog row token, conditional exact id/token count, monotonic `max(now, previous + 1ms)` and persisted read-back. Canonical no-op performs authorization/token checks but no write or timestamp bump. Deletion counts all references, including Category references across all Article owners/statuses, before exact delete; Category's schema SetNull is not used as an implicit detach operation. P2002/P2003/P2034 and count/read-back failures map to controlled errors; there is no hidden retry. Revalidation failure after commit returns canonical success plus a warning.

### Classification snapshot and transaction

Page permission checks precede domain lookup. Query, picker and mutation independently verify the current ACTIVE user and unchanged session role, then apply `articleCmsScope` before reading parent relations/options. Mutations additionally require DRAFT/CHANGES_REQUESTED and a supported stored editor document. Missing session returns a safe failure without redirecting an in-progress form.

The payload is the complete selection snapshot plus `Article.updatedAt`. Strict dense unique ID arrays enforce topics <=5, tags <=10 and instruments <=10; primary is null or a selected instrument. Target existence/kind/eligibility is re-read inside the transaction. Attached inactive entries can remain, be removed or become primary; inactive entries cannot be newly attached. Reads preserve excess legacy selections and report multiple primaries rather than silently repairing/truncating data. DTOs contain explicit plain data and ISO strings, and are exercised through the installed Flight codec with temporary references.

Serializable mutation order: fresh actor/scoped editable parent → expected token → consistent current selection → target validation → canonical no-op check → conditional parent claim → exact mapping diff → persisted parent/selection ACK. The parent update changes only `categoryId` and `updatedAt`. Old primary flags are cleared before promoting a new one. Any child/count/commit failure rolls back the parent and mappings. The no-op path still checks authorization, stale token and targets. No token refresh/resubmit loop exists.

Local action adapters execute the actual classification, draft UPDATE, source create/update/delete and catalog delete/deactivate functions for both commit orders. They check one-winner semantics, rollback and preserved Article/body/owner/status/source/catalog fields. These adapters prove application orchestration and predicates; **they do not prove MariaDB locking, isolation or DATETIME(3) persistence**. Those checks are implemented in browser cases and remain NOT RUN.

### UI, recovery and navigation

Both controllers are manual-only with synchronous single-flight guards and immutable request snapshots. Mount/change/search/idle do not write. Known offline prevents dispatch; returning online does not auto-save. Conflict, permission loss and unknown ACK preserve input and block blind writes; an explicit reload requires confirmation. A catalog CREATE with lost ACK cannot be resubmitted as a second create from the same blocked form. Pending lifetime reactivation becomes an unknown-result barrier; late ACK/search generations cannot overwrite another form instance or a newer dirty selection.

Native labels/fieldset controls, visible errors/status, focus-to-error, keyboard interaction and min-width/wrapping classes support the requested layouts. Names/descriptions render as React text, never HTML or fetched URLs. Browser assertions for 390/768/1280 and HTML-like text are present, not yet executed.

Creator navigation exposes catalog management only to `cms:admin`; Article list exposes scoped classification links, persisted editor and sources expose guarded links, and `/new` shows only the save-first hint. Actual component/effect tests cover cancel/accepted leave and preservation of the editor debounce/source draft. Existing autosave/controller, native paste, AUTO-21 and FMT_CODE_BLOCK code remain unchanged.

## 2. Harness v3 and data protection

The future guarded runner creates manifest v3 with 108 run-owned seed catalog records (27 per kind), exact natural identities and reserved UI CREATE intents. Seed identities are checked absent before writes. UI intents record exact expected initial metadata and prove absence before UI submission; lost-ACK recovery requires the reserved identity plus matching metadata, then persists the recovered ID. Prefixes, labels and “an admin created it” never grant ownership. Known IDs/keys/tuples cannot drift; retained tombstones prevent adopting replacement rows under a reused key.

Graph recovery validates both endpoints of Article↔topic/tag/instrument mappings and Article↔category, including reverse references from a fixture catalog into a foreign Article. Article counts must agree with the exact approved graph. Source parent/creator checks and all prior unrelated-relation guards remain. An invalid graph prevents partial catalog/source/mapping journaling; exact owned Article discovery can already have been journaled before the full graph check. v1/v2 have explicit legacy fixture setups/tests, keep their old authority and cannot acquire taxonomy cleanup rights.

Cleanup validates the whole graph first, deletes exact source rows and mappings/clears exact fixture category links before Article/User/catalog deletion, and checks finite IDs plus identities. Transaction and post-commit verification require all **13 counters** to be zero: articles, profiles, users, logs, sources, categories, topics, tags, instruments, topicMappings, tagMappings, articleInstruments and categoryLinks. Failure rolls back where still inside the transaction, preserves the recovery journal, and never prints VERIFIED. The runner requires confirmed fixture setup before recovery/deletion, so a collision or uncertain setup cannot trigger automatic cleanup.

Local harness tests cover every counter failing inside/after TX, malformed/foreign identities, both foreign edge directions, natural-key reuse, lost ACK, partial/already-clean graphs, journals, rollback and legacy denial. **No fixture or cleanup was run against a database in this task.** The 13 zero counters and `CMS_E2E VERIFIED` must come from a later authorized guarded staging run.

`cms-sources.spec.ts` changes only its setup version gate and recovery dispatch for valid v3 while retaining provenance and business assertions. Diagnostics adds 35 exact TAX titles/static step mappings and the one new approved source file; output remains allowlisted with raw values/errors/credentials suppressed. The TAX helper reads only public client action export metadata, differentiates mutations from search by exact action ID and route, and delays/drops the response to an actual `route.fetch()` rather than fabricating success. Unrelated aborted public chunks do not invalidate already-resolved required exports; missing/ambiguous required exports still fail. All six action exports were also verified against the real isolated production build's public chunks. The private server-reference manifest was not read.

## 3. Changed files (49; all unstaged)

New product source/routes (15):

```text
src/app/creator/taxonomy/page.tsx
src/app/creator/articles/[id]/classification/page.tsx
src/features/cms/taxonomy.ts
src/features/cms/taxonomy-store.ts
src/features/cms/taxonomy-query.ts
src/features/cms/taxonomy-actions.ts
src/features/cms/taxonomy-panel.ts
src/features/cms/components/TaxonomyCatalog.tsx
src/features/cms/article-classification.ts
src/features/cms/article-classification-store.ts
src/features/cms/article-classification-query.ts
src/features/cms/article-classification-options.ts
src/features/cms/article-classification-actions.ts
src/features/cms/article-classification-panel.ts
src/features/cms/components/ArticleClassificationPanel.tsx
```

Existing product navigation only (4):

```text
src/app/creator/page.tsx
src/app/creator/articles/page.tsx
src/features/cms/components/ArticleDraftForm.tsx
src/features/cms/components/ArticleSources.tsx
```

Harness/diagnostics (6; two new modules):

```text
scripts/cms-e2e/fixtures.mjs
scripts/cms-e2e/taxonomy-fixtures.mjs
scripts/cms-e2e/cleanup.mjs
scripts/cms-e2e/run.mjs
scripts/cms-e2e/diagnostics.mjs
scripts/cms-e2e/taxonomy-diagnostics.mjs
```

New tests/browser support (14):

```text
tests/cms-taxonomy.test.mjs
tests/cms-taxonomy-actions.test.mjs
tests/cms-taxonomy-panel.test.mjs
tests/cms-taxonomy-form.test.mjs
tests/cms-taxonomy-routes.test.mjs
tests/cms-taxonomy-browser-support.test.mjs
tests/cms-article-classification-validation.test.mjs
tests/cms-article-classification-actions.test.mjs
tests/cms-article-classification-panel.test.mjs
tests/cms-article-classification-form.test.mjs
tests/cms-article-classification-routes.test.mjs
tests/cms-e2e-taxonomy-harness.test.mjs
tests/e2e/cms-taxonomy-support.ts
tests/e2e/cms-taxonomy.spec.ts
```

Existing tests extended (7):

```text
tests/cms-article-draft-form.test.mjs
tests/cms-article-draft-routes.test.mjs
tests/cms-article-source-form.test.mjs
tests/cms-dashboard.test.mjs
tests/cms-e2e-diagnostics.test.mjs
tests/cms-e2e-harness.test.mjs
tests/e2e/cms-sources.spec.ts
```

Documentation (3): `tests/README.cms-e2e.md`, `docs/cms/ROADMAP.md`, this report. Local filtered wrappers, logs and isolated build evidence live under ignored `.next`; they are not implementation artifacts to stage.

## 4. Baseline regression mapping

| Baseline | Delta and reason | Evidence |
|---|---|---|
| CMS-005 rich text transport / validation / native clipboard / FMT_CODE_BLOCK | No source or browser assertion change | Full unit suite PASS; original EDIT discovery retained; actual browser NOT RUN |
| CMS-006 controller / concurrency / DATETIME(3) / AUTO-21 | No implementation or browser assertion change | Full unit suite PASS; original 16 AUTO cases retained; actual DB/browser NOT RUN |
| ArticleDraftForm and draft route tests | Add save-first/persisted classification link and actual cancel/leave/debounce checks; retain previous expectations | Focused navigation run and full suite PASS |
| ArticleSources component/form test | Add classification link through existing guard and verify dirty input retained on cancel | Focused navigation run and full suite PASS |
| Dashboard/list | Add permission-based catalog navigation and scoped classification links | Actual page tests PASS |
| 19 SRC browser cases | Setup accepts explicit v2/v3; recovery uses v3 graph dispatch only for v3, no business assertion weakened | Full legacy harness PASS and 19 SRC cases discovered |
| Legacy fixture tests | Explicit `version=2` plans in old test setup instead of changing all expectations to v3 | 35 legacy harness tests PASS; v1/v2 taxonomy-denial tests added |
| Diagnostics | Exact new registry and taxonomy source location only; unknown output, sensitive fields, case/step pairing and legacy protocol remain guarded | Existing plus new diagnostics/protocol tests PASS |

No timeout/retry increase, skip, removal of assertions or direct JSON substitute for browser UI/native paste. Discovery retains all **55 baseline cases =20 EDIT +16 AUTO +19 SRC**.

## 5. Validation actually performed

Runtime: prepared **Node v22.23.2 / npm 10.9.8**, Next **16.2.6**, Prisma **7.8.0**, Playwright **1.63.0**, existing dependencies. No install/download or package change.

All executable local gates ran through the existing ignored filtered wrapper `.next/cms006-local-20260926-05e7d1/run.cjs`. It constructs a child environment from OS/path allowlisted keys, supplies dummy loopback database/auth settings, disables env-file loading, and injects a guard rejecting `.env` reads and database TCP ports. The inherited staging URL/secrets were not copied. The historical wrapper directory/name is reused only for local filtering/logging, not a staging runner.

Commands below are the arguments executed by that wrapper with the prepared Node binary; `npm` resolves the npm CLI from that same prepared runtime. They are not instructions to run these directly from an inherited staging environment.

| Check / actual command | Result |
|---|---|
| Focused five catalog test files: `node --test tests/cms-taxonomy.test.mjs tests/cms-taxonomy-actions.test.mjs tests/cms-taxonomy-panel.test.mjs tests/cms-taxonomy-form.test.mjs tests/cms-taxonomy-routes.test.mjs` | **54/54 PASS** (pure 10, actions/query/Flight 24, controller 12, actual component/effects 5, route 3) |
| Focused five `tests/cms-article-classification-*.test.mjs` files | **62/62 PASS** (validation 6, actions/query/Flight/concurrency 26, controller 18, actual component/effects 8, routes 4) |
| `node --test tests/cms-e2e-harness.test.mjs tests/cms-e2e-taxonomy-harness.test.mjs` | **57/57 PASS** =35 legacy +22 v3 |
| Focused draft/source/dashboard/routes and TAX protocol run | **91/91 PASS** at that checkpoint; a further protocol regression is included in final full suite |
| Focused diagnostics + initial TAX protocol run | **27/27 PASS** at that checkpoint; final suite also covers unrelated failed chunk/ambiguous ID regression |
| Final `node --test tests/cms-e2e-diagnostics.test.mjs tests/cms-taxonomy-browser-support.test.mjs` after browser coverage additions | **28/28 PASS** =22 diagnostics +6 protocol; 0 failed/skipped/cancelled |
| `npm run test:unit` | **761 tests /761 PASS /0 FAIL /0 skipped /0 cancelled /0 todo**; baseline 612 plus 149 additional tests |
| `node node_modules/prisma/build/index.js validate --config .next/cms008-local-20260929/prisma.config.ts` | **PASS**, env-free dummy config; no DB connection |
| Same Prisma CLI/config, `generate` | **PASS**, generated Prisma client only; no schema/migration/DB operation |
| `npm run lint` | **PASS**, no errors/warnings |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS** |
| `node .next/cms008-local-20260929/build-local.cjs` → `npm run build` in a fresh isolated snapshot | **PASS**, 167 allowed source/public/config inputs, before/after hashes equal, `mismatches=[]` |
| `node .next/cms008-local-20260929/verify-public-actions.mjs` | **PASS**, six expected action identities found in two public `.next/static/chunks/*.js` build outputs; no private manifest access |
| `node node_modules/@playwright/test/cli.js test --list` | **90 cases discovered =55 baseline +35 TAX**, no browser/app/global setup/DB run |
| `git diff --check` and whitespace/conflict-marker scan of untracked files | **PASS** |

Build evidence: `.next/cms008-local-20260929/build-evidence.json`; 167 copied app/config files, generated snapshot under its own `build-snapshot`, dummy environment, shared installed node_modules junction. Next emitted a workspace-root/multiple-lockfile warning because the isolated snapshot sits under the repository; build still exited 0 with both new dynamic routes compiled. Native TypeScript imports emit the existing module-type warning; no runtime/dependency config was changed to suppress it. Build never started a production/staging app.

Final local logs: `.next/cms006-local-20260926-05e7d1/cms008-final-{unit,lint,tsc,build}.log`, `cms008-public-actions.log` and focused logs in the same ignored directory. No raw environment, credentials, manifests or browser traces are included in this report.

After the full gates, read-only coverage review prompted two browser-only additions: TAX-06 uses distinct ADMIN/SUPER_ADMIN sessions, and TAX-10/11 separately persists primary switch/null and nonempty replacement with DB/reload assertions. Case titles/counts stayed unchanged. Focused browser-file lint, whole-project TypeScript, diagnostics/protocol tests and 90-case discovery were rerun for that delta. Product source did not change after the successful build; full unit suite/build were not repeated just for browser/report edits.

## 6. AC mapping (all 36)

**L PASS** below means implementation and corresponding local/static evidence passed. **B NOT RUN** means the required browser/MariaDB evidence is still pending; it does not mean final acceptance. AC-33/36 retain their later process gates.

| AC | Implementation/evidence | Checkpoint |
|---|---|---|
| CMS008-AC-01 | Existing four catalogs/category FK/three mappings; forbidden-path diff empty | L PASS |
| CMS008-AC-02 | Thin catalog/classification routes; actual route guard-order tests; TAX-01 | L PASS / B NOT RUN |
| CMS008-AC-03 | Fresh actor/session-role/status + own/any before selected/options; TAX-01/13/19/20 | L PASS / B NOT RUN |
| CMS008-AC-04 | Four static create/update paths, immutable identities, explicit DTO; TAX-02/03 | L PASS / B NOT RUN |
| CMS008-AC-05 | Strict descriptors, Unicode/int/boolean/slug/token boundaries; TAX-04 | L PASS |
| CMS008-AC-06 | Server canonical key/normalization/reserved venues/duplicate key; TAX-05 | L PASS / B NOT RUN |
| CMS008-AC-07 | Bounded deterministic count/list + selected retention; TAX-09 | L PASS / B NOT RUN |
| CMS008-AC-08 | Three active models, Tag no active, inactive retained/removed; TAX-07 | L PASS / B NOT RUN |
| CMS008-AC-09 | All-kind used guard, exact delete, Category SetNull blocked; TAX-08/30 | L PASS / B NOT RUN |
| CMS008-AC-10 | Catalog row CAS/persisted +1ms/no-op/rollback; TAX-06/27 | L PASS / B NOT RUN |
| CMS008-AC-11 | 0..1/5/10/10 limits + primary membership and switch/clear; TAX-10/11/12 | L PASS / B NOT RUN |
| CMS008-AC-12 | Dense IDs, duplicates/unknown/wrong-kind/extras rejected; TAX-12 | L PASS |
| CMS008-AC-13 | Eight excluded statuses/unsupported document retain selected read-only; TAX-14 | L PASS / B NOT RUN |
| CMS008-AC-14 | One transaction snapshot, plain Flight DTO, legacy warnings not repairs; TAX-10/29 | L PASS / B NOT RUN |
| CMS008-AC-15 | Parent CAS + category/mapping exact diff atomic; injected rollback; TAX-10/11/27 | L PASS / B NOT RUN |
| CMS008-AC-16 | Authorized/token-checked no-op, no write, stale conflict; TAX-11/18 | L PASS / B NOT RUN |
| CMS008-AC-17 | Explicit preserved parent/source/catalog comparisons; TAX-03/11/16/17 | L PASS / B NOT RUN |
| CMS008-AC-18 | Same-token winner/loser input + explicit reload; TAX-15 | L PASS / B NOT RUN |
| CMS008-AC-19 | Actual draft/classification adapters both orders + browser autosave barriers; TAX-16 | L PASS / B NOT RUN |
| CMS008-AC-20 | Source create/update/delete vs classification both orders; TAX-17 | L PASS / B NOT RUN |
| CMS008-AC-21 | Actual catalog/assignment adapters both orders + real-response browser cases; TAX-30 | L PASS / B NOT RUN |
| CMS008-AC-22 | Manual controllers/single-flight/read-only search; TAX-09/21 | L PASS / B NOT RUN |
| CMS008-AC-23 | Offline/conflict/unknown ACK retains input, no duplicate retry; TAX-15/22/23 | L PASS / B NOT RUN |
| CMS008-AC-24 | Native/app navigation and existing editor/source guards; TAX-24/29 | L PASS / B NOT RUN |
| CMS008-AC-25 | Fresh revoked role/status/owner/session returns safe failure; TAX-19/20 | L PASS / B NOT RUN |
| CMS008-AC-26 | Post-commit cache error yields success-warning, no second write; TAX-28 | L PASS |
| CMS008-AC-27 | React text/native controls/error focus + responsive browser assertions; TAX-25/26 | L PASS / B NOT RUN |
| CMS008-AC-28 | Strict v3 journals/reservations; explicit legacy denial; TAX-32 | L PASS / B NOT RUN |
| CMS008-AC-29 | Both graph endpoints/category reverse refs/key drift and collision guards; TAX-32 | L PASS / B NOT RUN |
| CMS008-AC-30 | Exact intent adoption/graph journal/rollback and preserved manifest; TAX-22/32 | L PASS / B NOT RUN |
| CMS008-AC-31 | 13-counter transaction+post checks, guarded VERIFIED gate; TAX-32 | L PASS / real counters NOT RUN |
| CMS008-AC-32 | All 55 baseline discovered, business assertions retained, safe 90-case registry | L PASS / B NOT RUN |
| CMS008-AC-33 | This mapping/counts/report/runbook; review before later gates | L PASS; Claude review/CI/staging NOT RUN |
| CMS008-AC-34 | No real DB/staging/production/seed operation performed | PASS for this local task |
| CMS008-AC-35 | PO manual UAT deferral preserved in report/roadmap/runbook | DEFERRED, not PASS |
| CMS008-AC-36 | Existing release workflow untouched; no commit/release/COMPLETE claim | Release NOT RUN |

## 7. TAX mapping (all 32)

All local entries below passed. The 35 new browser tests use 26 fixed TAX step codes and expand actor/order parameterizations. **27 scenarios require L+B; five are L-only (04/12/27/28/29)**. Every B entry remains NOT RUN. TAX-31 maps to the 55 baseline cases and TAX-32 to the guarded lifecycle; neither needs an extra `test()` that duplicates those operations.

| TAX | Local evidence | Browser implementation / static step |
|---|---|---|
| TAX-01 | Actual route guards; fresh auth/scope/query-order action tests | Anonymous/creator/foreign/non-CMS route matrix; `TAX_ACCESS` |
| TAX-02 | All four create actions and canonical DTO/Flight | ADMIN and SUPER cases × four forms/DB/reopen; `TAX_CATALOG_CREATE` |
| TAX-03 | Metadata whitelist/identity and preserved-parent assertions | Four-kind edits preserve Article/source; `TAX_CATALOG_METADATA` |
| TAX-04 | Hostile object/array/error accessors, Unicode/number/date bounds | L-only |
| TAX-05 | Canonical key examples/normalization/reserved exchange/unique errors | Normalized creation/readonly identity/duplicate key; `TAX_INSTRUMENT_IDENTITY` |
| TAX-06 | CAS same-token winner/no-op/stale/persisted precision | Two admin-capable actors, future +1ms then +2ms; `TAX_CATALOG_TOKEN` |
| TAX-07 | Eligibility re-read, retained inactive/remove/primary behavior | Retained inactive, primary, removal/reactivation/stale options; `TAX_INACTIVE` |
| TAX-08 | Every reference count, used category guard, exact deletes | Four-kind cancel/unused delete and used blockers; `TAX_DELETE_GUARDS` |
| TAX-09 | Bounded sorted count/list/options + search generations | Pagination/search/empty/selected retention/no writes; `TAX_SEARCH_PAGING` |
| TAX-10 | Exact assignments/primary/persisted snapshot | Full graph and reload; `TAX_SELECTION_ROUNDTRIP` |
| TAX-11 | Replacement/primary switch/null/clear/no-op/preserved fields | Persisted replacement and primary switch/null, then clear; same roundtrip case |
| TAX-12 | Strict array types/density/duplicates/limits/existence/kind/primary | L-only |
| TAX-13 | Fresh creator own/admin any without changing attribution | ADMIN/SUPER foreign Article/source attribution; `TAX_ASSIGNMENT_SCOPE` |
| TAX-14 | All ten statuses/unsupported document read-write rules | CHANGES_REQUESTED, eight excluded states, unsupported doc; `TAX_READ_ONLY` |
| TAX-15 | Same token one winner, losing controller input/barrier | Two tabs actual ACK held, loser retains input/reloads; `TAX_TWO_TABS` |
| TAX-16 | Actual draft UPDATE/classification actions both orders | Two autosave/classification winner orders; `TAX_AUTOSAVE_CONFLICT` |
| TAX-17 | Actual source create/update/delete vs classification both orders | Six cases (three operations × two orders); `TAX_SOURCE_CONFLICT` |
| TAX-18 | Future +1ms token, persisted read-back, stale conflicts | Consecutive MariaDB saves/stale tab; `TAX_ARTICLE_TOKEN` |
| TAX-19 | Session/actor role/status + parent owner/status CAS | Revoked sessions/actors and changed parent; `TAX_ACTOR_REVOKED` / `TAX_PARENT_REVOKED` |
| TAX-20 | Catalog session/fresh admin role/status before reads/writes | Suspended/demoted/expired session; `TAX_ADMIN_REVOKED` |
| TAX-21 | Manual-only read/change/idle + synchronous single-flight | Both panels idle/change/doubleclick; `TAX_MANUAL_SINGLE_FLIGHT` |
| TAX-22 | Unknown ACK barriers + strict reserved create recovery | Real CREATE/classification commit with dropped actual ACK; `TAX_CATALOG_UNKNOWN_ACK` / `TAX_CLASSIFICATION_UNKNOWN_ACK` |
| TAX-23 | Offline prevents dispatch, online does not write, manual recovery | Both panels offline/online request and DB checks; `TAX_OFFLINE` |
| TAX-24 | Actual component effects and dirty/late ACK controllers | Native beforeunload/app-link/form cancel/leave; existing editor/source links; `TAX_PANEL_NAVIGATION` / `TAX_LINKS_REGRESSION` |
| TAX-25 | DTO/React text rendering, no HTML path | HTML-like name/description/retained data/no execution; `TAX_ACCESSIBLE_TEXT` |
| TAX-26 | Native labels/fieldset/status/error focus component tests | Keyboard and 390/768/1280 widths/overflow; `TAX_ACCESSIBLE_TEXT` |
| TAX-27 | Parent/child/commit/unique/FK/deadlock/count mismatch injection with rollback | L-only |
| TAX-28 | Actual post-commit revalidation throws but canonical success-warning | L-only |
| TAX-29 | Real installed Flight codec, malformed legacy, StrictMode/sync/late reads/ACK | L-only |
| TAX-30 | Catalog delete/deactivate and assignment actual actions both orders | Three DB outcome cases (assign/deactivate/delete first); `TAX_CATALOG_ATTACHMENT_RACE` |
| TAX-31 | All existing unit suite retained; baseline diff inspection | Existing 55 EDIT/AUTO/SRC cases remain; browser NOT RUN |
| TAX-32 | 35 legacy +22 v3 harness tests, safe diagnostics/protocol tests | All cases through guarded runner/recovery/cleanup/provenance; real 13 counters/VERIFIED NOT RUN |

## 8. Review targets and handoff

Claude should independently review strict descriptor validation/safe error mapping; catalog identity and used Category deletion; fresh authorization and conditional Article claim; inactive retention/legacy repair behavior; persisted token precision and rollback; controller lifetime/search/unknown-ACK behavior; fixture v3 ownership/recovery/legacy authority; and whether real-request TAX assertions establish the required concurrency outcomes. Review the source of the public action metadata matcher against the pinned build output before changing Next pins.

Local validation is not evidence that browser selectors, login timing, real transaction locking or cleanup have passed. After independent review and any confirmed fixes, a separately authorized commit/PR/CI step must test the exact new head, followed by guarded staging of all 90 cases with a new runId/BUILD_ID and 13-counter cleanup verification. Manual UAT remains deferred by PO.

Final Git checkpoint: same branch/HEAD/parent as preflight; index empty; **49 implementation/source/test/runbook/report paths unstaged (17 modified +32 untracked)**. `git rev-list --left-right --count HEAD...origin/feature/cms-008-taxonomy-instruments` reports **0 / 0**, relative to the fetched tracking ref. `git diff --check` and all-49-path whitespace/conflict-marker scan passed. Git emitted a warning that the sandbox could not read the user's global ignore file; repository status/untracked listing and checks completed with exit 0. No `.next` artifact, manifest, log, credential or environment file belongs to the diff. No git add/commit/push/PR/merge/deploy, SSH, real DB, fixture/cleanup or migration operation was performed.
