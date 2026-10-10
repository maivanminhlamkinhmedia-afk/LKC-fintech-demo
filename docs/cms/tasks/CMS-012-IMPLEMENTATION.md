# CMS-012 implementation handoff — proposed slices, not permission to implement

Status: PLAN_DRAFT, 10/10/2026. Paired with [CMS-012 specification](CMS-012.md). Sources pinned for design: CMS-011 spec a37abc99c2057e4b100b4955694d4f62460e32a7 (PR #28), pure policy f909aa3f5eca7ed56ed7337853ad6252f1ccb419 (PR #30), physical foundation b54cf928bf511dfd46d4fec0931856a3e633a8b7 (PR #34), pure queue 83f799ee1f3db5a2fd8fec00b2d24e95adc1fca9 (PR #39), governance 424ff4b85e99a38d888e31c0dedbff28bceb7987 and registry 3d7242059115aa9220ad01c4cadfc0d680c4d1b4. All are separate refs; none is presumed merged to main. Do not copy a passing CI result from one SHA to another.

## Dependency and readiness ledger

| Dependency | Current evidence | Gate it actually affects |
|---|---|---|
| G0 CMS standing ownership | CMS-private docs and article policy are lane A after overlap check; shared schema/media/contract/harness remain B and release/real DB C | CMS-012 pure policy may be proposed independently; shared files need single-writer handoff |
| CMS-011.0 policy and .1 foundation | Pure transitions and version/same-Article schema exist on independent PR heads; nullable legacy review links and no CMS-012 writer | Pure version identity can be designed now. Runtime requires pinned integration base and DB compatibility proof |
| CMS-011.2 submit/TAKE/queue runtime | Q0 only projects supplied SUBMITTED rows; no live submit/queue action established by this spec | No live reviewer fact-check/request-changes flow until runtime owner supplies authoritative version and actor transaction |
| Audience Physical + C01 | Audience writer/physical/product integration is a separate dependency; C01 producer may not be present on the chosen source base | PAID_PRODUCT resubmit/approve held fail-closed; pure identity and note privacy work need not wait |
| C06 version media | Version→cover edge and delete guard have separate reviewed CMS slices; real reference/lock/cleanup proof remains gated | No version snapshot activation or fixture graph claims from pure policy |
| Business policy | FACT_CHECK state, REQUEST_CHANGES authority/assignment/reason, note visibility, pointer handling, REJECT, self-review OPEN | Do not implement a runtime transition or author-visible note before PO decision |
| CMS-013/015/reader | Version history/correction, publication pointer and paid reader are separate tasks | CMS-012 never writes publish state or serves paid body |

Before each source PR, verify main/branch HEAD, remote dependency heads, exact path collisions and active claims. A new file or pure policy does not override a shared consumer boundary. Stacked PR diff must be limited to its declared paths. If the base changes, revise paths/dependencies and obtain review of the affected delta; do not merge all docs branches to read them.

## Proposed step 012.P — pure version-bound input/safe-result policy

Outcome: validate supplied actor/article/version DTO shape, same-Article identity, expected updatedAt/version token, safe error union, and an explicit pending result for undecided FACT_CHECK/REQUEST_CHANGES/REJECT policy. No state transition is returned while decisions are OPEN. This is the smallest CMS-private step independent of Audience Physical/C01 producer.

Suggested source base: b54cf928bf511dfd46d4fec0931856a3e633a8b7, with f909aa3f5eca7ed56ed7337853ad6252f1ccb419 as transitive dependency. If queue types are imported, explicitly stack on 83f799ee1f3db5a2fd8fec00b2d24e95adc1fca9; otherwise do not claim that dependency. Proposed branch feature/cms-012-fact-check-policy. Exact CREATE paths:
- src/features/cms/article-fact-check-contract.ts
- src/features/cms/article-fact-check-policy.ts
- tests/cms-article-fact-check-policy.test.mjs

MODIFY: none. Forbidden: prisma, roles/auth, shared contracts, media-actions, writer, routes/UI, harness and workflow. AC 01-09, 11, 13, 19-20 and 23 only for structural/pending/safe-output portions; no assertion that a runtime write or note visibility is approved. Focused tests include foreign version, legacy null, invalid/hostile objects, stale token, role/scope and every undecided transition returning pending, no side effects or secret fields. Node 22 focused tests, scoped lint, TypeScript and diff-check are required; Claude independent review before Draft PR/CI. This step is a proposal, not an active source slot or instruction to implement it now.

## Proposed step 012.S — physical version-bound storage, shared B

Start only after PO note lifecycle/visibility and transition decisions plus Integrator schema ownership handoff. Preferred model direction: reuse ArticleReview for typed REQUEST_CHANGES decision with non-null version on new rows, keep legacy nullable history, extend ArticleReviewEvent action for the approved transition, and add typed version-bound fact-check records rather than hiding identity/visibility in free-text comment or JSON. The exact record fields and whether EditorialComment is reused or superseded remain OPEN; choosing them before policy would create a false contract. Preserve composite same-Article FK, append-only history, Restrict retention, indexes for scoped version/history queries and a deliberate cleanup order. Do not backfill legacy reviews into approved decisions or public notes.

Proposed branch feature/cms-012-fact-check-schema stacked on the then-current reviewed integrated foundation/Product base. Candidate exact paths to reserve only after decision:
- MODIFY prisma/schema.prisma
- CREATE prisma/migrations/20261010160000_cms012_version_bound_fact_check/migration.sql
- CREATE tests/cms-fact-check-schema.test.mjs

The migration path is a candidate, NOT a reservation or permission to write shared schema. Integrator must inspect migrations for timestamp collision and pin a final path/owner. AC 04-05, 10, 14, 22, 25-26. Validate Prisma schema/generated client, offline SQL/schema consistency and disposable target-MariaDB DDL with legacy rows, FK negative tests and mixed-version behavior under a separately authorized DB checkpoint. Static schema tests or Ubuntu CI are not DB execution proof. Plan expand-compatible migration, old-client reads and application rollback to old client on expanded schema; DDL partially applied is inspected/reconciled, not assumed transactionally rolled back.

## Proposed step 012.A — transaction and scoped reads

Depends on approved PO policy, 012.P and 012.S, CMS-011 authoritative submit/TAKE runtime, fresh actor convention, and exact integration base. Candidate branch feature/cms-012-fact-check-actions. Exact CREATE:
- src/features/cms/article-fact-check-actions.ts
- src/features/cms/article-fact-check-query.ts
- tests/cms-article-fact-check-actions.test.mjs
- tests/cms-article-fact-check-query.test.mjs

Candidate MODIFY only if integration source exists on selected base: src/features/cms/article-review-contract.ts, src/features/cms/article-review-policy.ts, tests/cms-article-review-policy.test.mjs. These are not automatically claimed; Integrator/CMS owner must inspect drift and grant exact scope. No roles/auth or shared Product/C02 edit. Use one Serializable transaction client for fresh actor, scoped Article, exact version, approval invalidation, CAS and append-only decision/event. Check result of updateMany count and never retry ambiguous remote execution. Query returns distinct internal and author-safe projections; no note/body on denial. AC 01-05, 07-15, 17-20, 22-25. Inject failure after each write, competing reviewer CAS, cross-Article version, role revocation, lost ACK reconciliation and revalidation-after-commit. Run full related action suite, lint, TypeScript, Prisma tests where schema integration changed, and independent review/CI. Real MariaDB concurrency remains a separate technical gate.

The existing working-copy writers to review for invalidation are exact known paths: src/features/cms/article-draft-actions.ts, src/features/cms/article-source-actions.ts, src/features/cms/article-classification-actions.ts, and src/features/cms/media-actions.ts for cover; audience writer path must be named when its reviewed source exists. Do not modify these as part of 012.A by implication. Any required CAS/invalidation edit is a separately scoped integration slice with owner/Media handoff, matching regression and legacy journal behavior. Keeping ArticleVersion immutable does not alone invalidate approval when a working writer changes content.

## Proposed step 012.U / 012.H — UI, browser and recovery activation

Start after runtime query/action, visibility decision and current installed Next documentation review. Candidate 012.U branch feature/cms-012-fact-check-ui. Exact CREATE:
- src/app/creator/articles/[id]/review/page.tsx
- src/features/cms/components/ArticleFactCheckPanel.tsx
- tests/cms-article-fact-check-panel.test.mjs

Potential MODIFY for navigation from existing reviewer queue/editor is not granted here; the actual runtime queue route must first exist and its exact path be provided. A route path is a proposal, not proof the current app routes to it. Render inert note text, separate author-visible from internal projection, preserve autosave/single-flight and no unsaved snapshot capture; no form-driven permission increase. AC 01-03, 15-16, 19-21. Test direct-route/Flight denial and browser network attempts, not only component SSR escaping.

Candidate 012.H branch feature/cms-012-fact-check-harness. Exact CREATE tests/e2e/cms-fact-check.spec.ts. Candidate MODIFY scripts/cms-e2e/diagnostics.mjs and tests/README.cms-e2e.md only after runner registration review; other fixture/cleanup/registry paths must be enumerated from the then-current harness and receive shared ownership clearance before implementation. Never reuse 19 old cleanup counters to claim graph coverage. Journal exact synthetic Article, version, media edge, finding, decision and event ownership; cleanup dependent rows before version/Article and preserve unknown external data. AC 10-26, with negative auth/privacy, multiple reviewers, fault injection/recovery and full baseline discovery. Guarded staging requires new runId/BUILD_ID/head, exact final case count, exit 0/VERIFIED and measured cleanup graph. No timeout/retry relaxation or DB manual cleanup. Media/paid-body probes use synthetic data only.

## AC-to-gate summary and release boundary

| Gate | Coverage | Required evidence |
|---|---|---|
| Pure P | 01-09, 11, 13, 19-20, 23 structural portions | Focused positive/negative tests; OPEN decisions return pending |
| Physical S | 04-05, 10, 14, 22, 25-26 | Schema/FK tests, target MariaDB DDL/legacy/mixed-version proof separately authorized |
| Action/query A | 01-05, 07-15, 17-20, 22-25 | Transaction fault/race/recovery and privacy tests against actual adapter |
| UI U | 01-03, 15-16, 19-21 | Component plus browser DOM/Flight/network checks |
| Harness H | 10-26 | Full guarded baseline + new cases, exact journal/cleanup graph and independent review |

Each slice uses Codex implementation → Claude independent review → fix/regression if needed → exact-path commit/Draft PR/CI on the actual head. CI success does not approve business decisions, establish MariaDB locking, or equal staging. No schema migration, merge, deploy, publication, paid-reader activation or production UAT is authorized by these documents. Manual authenticated production UAT remains DEFERRED until the end of the project.
