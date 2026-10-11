# CMS_RELEASE_S1: disposable MariaDB rehearsal candidate

## Current authority and state

P1 authorizes local implementation, offline tests, an isolated worktree and a local commit for independent Claude 1 review. It does **not** authorize remote publication, PR creation, labels, Actions execution, containers, database connections, migrations, fixtures, staging or production access.

`S1_LOCAL_IMPLEMENTATION_GO / REMOTE_PUBLICATION_HOLD / S1_EXECUTION_HOLD / PRODUCTION_HOLD`

The workflow has a literal disabled job guard and the harness has `EXECUTION_GRANT = null`. A matching label, environment variable, argument or supplied approval object cannot enable this candidate. Future execution requires a separate approved, independently reviewed integration change that binds the grant to immutable workflow/harness/source identities. Removing one guard is not a valid execution grant. P1 contains executable rehearsal logic behind these closed boundaries; implementation and offline PASS are not runtime evidence.

Exact ownership is CREATE 6 / MODIFY 0:

1. `.github/workflows/cms-release-s1.yml`
2. `scripts/cms-release-s1/run.mjs`
3. `scripts/cms-release-s1/fixture-plan.mjs`
4. `scripts/cms-release-s1/metadata.mjs`
5. `tests/cms-release-s1-safety.test.mjs`
6. `docs/cms/operations/cms-release-s1.md`

Worktree: `D:/lkc_phase1_rbac_patch/cms-release-s1-61c5591`.
Branch: `test/cms-release-s1-mariadb-rehearsal`.
Future dependency base: `feature/cms-0112-q1-review-queue-readonly`, PR #56. Do not merge, rebase or change the frozen Q1 source to run this candidate.

## Immutable inputs and evidence sources

| Input | Identity |
| --- | --- |
| Repository | `maivanminhlamkinhmedia-afk/LKC-fintech-demo` |
| Q1 source | `61c5591bb875bffaeb3d71d2f734d39d1e87faf7` |
| Old application/client source | `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c` |
| Q1 schema Git blob | `2ac6b2c9688ddac6dcd20f1c0ec9f47007314858` |
| Q1 schema Git payload SHA-256 | `d2c6d315d0ccd7a17cc0598af5d5e57ad61465a1aa7e7e993e789cb1f0341e8d` |
| Node Linux amd64 image digest | `sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d` |
| MariaDB 10.11.14 Linux amd64 digest | `sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0` |

Image digests were checked using read-only registry metadata; neither image was pulled or run in P1. Record image ID, architecture, exact Node/npm/server/connector versions during an authorized run. A digest or `REAL_DRIVER` label is not proof that a process ran.

`fixture-plan.mjs` contains each migration's Git blob, exact LF payload SHA-256 and deterministic CRLF representation SHA-256. Git object identity, payload digest and raw checkout/artifact digest are separate fields; none replaces another. Verify inputs before opening a database connection. Resolve Prisma CLI/client/adapter from each pinned source's lockfile, with expected Prisma 7.8.0, and create separate generated clients. Do not share a generated client between old and expanded schema tests or silently substitute a globally installed Prisma CLI.

S0 staging metadata is **PO-observed**, not author execution evidence:

- Database `edpmjmha_lkcstage`; server `10.11.14-MariaDB-cll-lve-log`.
- Principal `edpmjmha_s0ro@localhost`, SELECT-only.
- SQL mode `ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`.
- Session isolation `REPEATABLE-READ`; timezone `SYSTEM`, actual offset unknown.
- Server/database `latin1` / `latin1_swedish_ci`.
- Observed 25 tables: InnoDB / `utf8mb4_unicode_ci`.
- Four completed historical migration records reconciled; three newer records absent.

No S0 connection information or credential is accepted by this harness. Upstream MariaDB 10.11.14 is not the VinaHost `cll-lve-log` binary. Matching selected configuration does not prove hosting parity or staging schema drift.

## Future workflow boundary

The candidate workflow receives only `pull_request: types: [labeled]`. In addition to the hard execution hold, it checks the exact repository and same-repository head/base, Q1 target branch, allowed rehearsal head branch, reviewed head and newly added event label `s1-<exact reviewed head SHA>`. Any mismatch must prevent the rehearsal job, including service startup. P1 has no reviewed execution head bound; event filtering is not approval.

A future approved run must pin the harness checkout to the authorized head and pin application/old-client checkouts separately to the two source SHAs above. Record event, run/attempt/job, workflow SHA, event SHA, PR head/base, checkout SHAs and synthetic merge parents when present. Never report a pinned source checkout as a synthetic PR merge.

Use `permissions: contents: read`, no persisted checkout credentials, no deployment environment, no repository/deploy secrets, no SSH, no VinaHost account and no production data. A job container communicates with the disposable MariaDB service by service DNS, with **no published database ports**. Reject unexpected host, database prefix/resource identity, existing unexpected schema/history, source SHA or digest. Use only synthetic test principals; never reuse S0's account. Generated transient credentials are runtime-only and must not appear in evidence or artifacts.

GitHub service networking does **not** provide OS egress isolation: outbound network remains possible. No claim of network-denied containment, supply-chain immunity or race-proof filesystem isolation is made. Pin actions/images, minimize tokens, install only locked dependencies in the approved preparation phase and collect allowlisted evidence. A separate security review must accept the residual egress risk before execution.

## Rehearsal matrix and order

Each scenario has a dedicated disposable database identity under the approved run namespace. No existing target is adopted. No broad cleanup is used to obtain a reusable baseline.

| Phase | Method and expected evidence |
| --- | --- |
| Input/resource preflight | Verify source, schema, migration, lockfile and image identities; verify exact disposable host/run/database ownership; missing or inconsistent authority refuses execution. |
| Configuration | Apply only separately approved disposable settings and read effective server/session values: SQL mode, isolation, timezone and actual offset, charset/collation, engine/FK configuration. Check actual Prisma transaction sessions rather than relying only on global defaults. |
| LF baseline | Apply the first four migration files with original Git LF bytes to a new database. Record exact artifact bytes, history/checksums and metadata. |
| Historical-EOL baseline | On a separate new database, derive the first three files by replacing LF with CRLF only; fourth stays LF. Verify original and derived digests. Do not edit source files or staging history. |
| Legacy fixture | Use the separately generated old Prisma client to create the deterministic legacy plan. Read a narrow snapshot of old Article/Version/Review fields and Article tokens before expansion. |
| Expansion | Apply foundation, Product, then audience migration, preserving original bytes and order. Compare legacy fields/tokens immediately afterward, before intentional expanded-fixture mutations. Inspect nullable new fields and history. |
| Expanded constraints | Execute the real Prisma operation plans. Positive typed edges must succeed; duplicate keys must return P2002; cross-Article/missing references and Restrict operations must return P2003. A generic exception is not a passing negative test. Verify table/index/FK definitions independently via metadata. |
| Mixed clients | Read legacy rows using the new client and perform narrow old/new client operations on owned rows with the expanded schema. Verify preserved old data and nullable/incomplete legacy behavior. No claim that old writers understand new approval invariants. |
| CAS/concurrency | Use independent real connections and deterministic barriers, not arbitrary sleeps/retry loops. Competing writes with the same Article token must not both win. Record transaction configuration and classify conflicts; an unclassified/lost response remains UNKNOWN_OUTCOME. |
| Timestamp/keyset | Use synthetic timestamp ties and the secondary ID key. Compare SQL ordering/precision with exact paged identity sets, no omissions or duplicates. Include collation-sensitive probes; do not assume JavaScript ordering equals MariaDB ordering. |
| Partial DDL | On a separate failure database, introduce an explicitly approved synthetic object collision and apply the unmodified migration. Preserve the first error, statement/history/schema evidence and durable partial effects. Do not claim transaction rollback of DDL. |
| Fresh recovery comparison | Rehearse successfully on a new empty database and compare normalized metadata with the successful control. This is fresh-database recovery evidence, not an in-place repair or production rollback. |
| Final evidence | Emit a bounded deterministic manifest of identities, phase results, expected error codes, metadata digests and file hashes. Keep raw-byte provenance and observed configuration distinct from normalized comparisons. |

Expected migration sequence:

1. `20260910081136_rbac_client_sales_creator`
2. `20260910105507_phase2_customer_crm`
3. `20260914050000_sales_team_member_user_unique`
4. `20260921130000_cms_financial_publishing`
5. `20261008155242_cms011_review_foundation`
6. `20261009003458_product_catalog_foundation`
7. `20261009190000_cms_article_audience`

The pure fixture plan uses fixed timestamps and owned deterministic IDs. It includes legacy Article/Version/Review records, independently seeded classification/media metadata, version-bound edges and Product bindings; these are direct synthetic DB fixtures, not application workflow activation. Media records have no filesystem objects: a passing version-media FK proves DB retention only, not the CMS delete guard or storage behavior.

The observed SQL mode is not strict mode. Record warning/coercion behavior where applicable, especially invalid ENUM/truncation cases; do not silently add strict mode to manufacture expected failures. `migrate status` and `migrate deploy` results are not substitutes for metadata and constraint execution evidence. In particular, migrate deploy is a write operation, never a read-only checksum audit.

## Failure containment and eventual disposal

Record an operation intent before submission and its bounded result afterward. Duplicate operation identifiers are rejected. A lost acknowledgement, transport failure or ambiguous commit stops dependent work with UNKNOWN_OUTCOME; no blind replay, automatic rollback, `migrate resolve`, history checksum edit or in-place repair is allowed.

A negative case passes only for the intended reason, with its expected safe code. Abort on unexpected success, unrelated failure or ownership mismatch. The harness must never log raw database/process exceptions, connection strings, SQL containing data, credentials, session material or untrusted stdout/stderr. Sanitize allowlisted fields and bound every artifact; detected unsafe output fails evidence collection rather than being forwarded.

No harness `DROP DATABASE`, broad row delete or recursive host cleanup is planned. During a future authorized run, GitHub's disposable service lifecycle removes the temporary container after evidence collection/job completion. Preserve failure evidence before lifecycle disposal. A future explicit resource cleanup grant must name exact owned resource IDs; it cannot authorize changes to VinaHost or production.

## Local validation and independent review

Only offline safety/static checks are authorized in P1. Example commands from the candidate worktree:

```powershell
$node22 = 'C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe'
& $node22 --test tests/cms-release-s1-safety.test.mjs
& $node22 --check scripts/cms-release-s1/run.mjs
& $node22 --check scripts/cms-release-s1/fixture-plan.mjs
& $node22 --check scripts/cms-release-s1/metadata.mjs
git diff --check
```

Use the available offline YAML parser/scoped lint tooling without installing dependencies. Safety tests must cover wrong source/head/label/event/repository/base, non-disposable endpoints, artifact mismatch, unsafe output, duplicate operation and UNKNOWN_OUTCOME handling. Test imports and planning with execution capability denied; never mock a successful database and label it runtime PASS.

Record actual commands/runtime/results in the local handoff. This document intentionally does not predict test counts or claim local tests ran before their evidence exists. Database, Docker, Actions, application/browser and MariaDB concurrency execution remain **NOT_RUN** in P1.

Before local commit, verify the exact six-path allowlist, empty/unexpected-index handling, parent Q1 SHA and unchanged historical migration/Q1 blobs. A local commit is expressly permitted before Claude 1 review in this checkpoint; it is not publication or independent approval. Supply Claude all six files, raw SHA-256 and Git-normalized blobs, local validation output and known limitations. Any source correction requires fingerprint refresh and regression review. No push/PR/label or execution follows automatically from author tests or Claude source PASS.

Separate gates remain: independent source review, authorized publication, execution grant/unlock integration review, one approved S1 run, results/partial-DDL assessment, and later staging/browser/release authorization. Q1 PR #56 stays OPEN/DRAFT; production UAT remains DEFERRED.

## P1 author validation record and remaining review gates

Author offline runs on Node 22.23.2 and 24.19.0 registered 43 safety tests: 42 PASS, 0 FAIL and 1 explicit Windows file-symlink permission SKIP. Directory-junction rejection executed and passed. The import audit observed zero attempted network, child-process, filesystem-mutation or timer calls. This audit covers module import and the tested closed runtime boundary, not operating-system egress isolation or execution of the database matrix.

The runtime matrix includes actual transaction lock-wait observation before releasing the first connection, exact timestamp comparison against fixture inputs, independent old/new generated clients and the real pinned snapshot consumer. Exact-owned pointer-cycle ordering and version-media release are tested separately from filesystem guards. Non-strict SQL warnings are observed without forwarding warning messages. These are implemented future checks, all RUNTIME_NOT_RUN.

Controlled CRLF artifacts are retained consistently within the historical-EOL scenario, with each applied checksum compared to its exact artifact bytes. Cross-scenario metadata and canonical schema diff are separate checks. This does not claim Prisma has already issued or suppressed a history warning against the hosting database; no historic checksum is rewritten.

Before execution, resolve the immutable approval-controller/harness binding. A workflow cannot embed its own eventual commit SHA by editing itself; P1's all-zero head and null grant are intentionally non-authorizing. A separate reviewed authority mechanism must bind the actual reviewed harness commit, operator, event and execution permission. No environment-variable or label-only shortcut is authorized.

Independent Claude review is PENDING. Source review must scrutinize every runtime operation, SQL/Prisma compatibility, journal durability and evidence failure path; offline tests do not exercise real Prisma calls, service startup, migration-engine output wording, Linux symlink permission branch or hosting behavior. Do not infer runtime readiness from the local commit.