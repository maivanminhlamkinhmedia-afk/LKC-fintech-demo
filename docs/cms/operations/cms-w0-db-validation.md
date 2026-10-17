# W0 disposable MariaDB validation — local candidate

Task LKC-C1-W0-DB-HARNESS-IMPLEMENT-001. Codex 1 is the sole writer for exactly eight new paths under the PO local-only grant. Claude 1 is the independent reviewer. No runtime approval, publication, CI, merge or release permission is implied.

## Immutable inputs

- Application W0 / PR #55: `5321f28673eeee11ed8f913c78c7cdcb38896f9e`.
- Reusable S1/B1 / PR #65: `f4c8fda177a81f96e13a05fa8a856128371835ad` (includes P7 parser/history correction).
- Independent old schema/client: `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`.
- W0 and reusable schema Git blob: `2ac6b2c9688ddac6dcd20f1c0ec9f47007314858`.
- Candidate branch `test/cms-w0-mariadb-validation`, base W0; proposed Draft target `feature/cms-access-001a-draft-writer-foundation`. No merge/cherry-pick of S1.

`fixture-plan.mjs` pins all three transitive reusable module blobs. `loadReusable` verifies these before import and exposes only fixture/metadata/helper functions, not the S1 executor. Q1 SOURCE_SHA does not become W0 authority. The B1 journal is NOT imported: it pins P7/host Docker identities; the W0 evidence module implements its own narrow journal.

## Exact scope

CREATE only: `.github/workflows/cms-w0-mariadb-validation.yml`; `scripts/cms-w0-db-validation/run.mjs`, `fixture-plan.mjs`, `action-bridge.mjs`, `evidence.mjs`; `tests/cms-w0-db-validation-safety.test.mjs`, `tests/cms-w0-db-validation-runtime.test.mjs`; this document. MODIFY/DELETE none. Existing W0, S1 guards, schema, migrations, package/lock and deploy/CI workflows remain immutable.

## Execution boundary

The new workflow contains a literal `false &&`, a zero reviewed-head placeholder and no active approval. The runner contains `EXECUTION_GRANT = null` and refuses before reading options or environment. Even replacing that constant alone is insufficient: the trusted approval/service-attestation integration is deliberately absent, and the public entry point stops at W0_TRUSTED_AUTHORITY_BRIDGE_REQUIRED. The internal matrix and DB cases are implemented; wiring them to verified external authority requires a separate reviewed grant. No caller approval JSON, CLI flag, REAL_DRIVER label or environment variable can mint the private runtime permit. The runtime-test module registers no tests at import and is not a fake PASS/SKIP from ordinary unit discovery.

Future activation requires separately reviewed integration of: exact candidate/workflow identity, actual protected approval and operator/run binding, service/container/network/image/no-published-port attestation, bounded output root and immutable source roots. A GitHub Environment created implicitly or lacking required protection is insufficient. Label matching is not approval or cryptographic single-use authorization. Re-run/relabel is not allowed by this checkpoint.

## Disposable target design (NOT provisioned)

GitHub Ubuntu 24.04; Node 22 job container; MariaDB 10.11.14 linux/amd64 service. Image digests in the workflow are inherited candidates, not re-verified image proof. No ports, host sockets/mounts, durable volumes, deployment secrets or SSH. Network egress remains possible; there is no OS egress-isolation claim. The workflow uses contents:read and immutable source/ref checkouts with persist-credentials:false. The PR event head is explicitly checked; never call its synthetic merge SHA the W0 source SHA.

Service bootstrap credential is synthetic and scoped to the ephemeral network. Independent random DDL/application passwords are held in memory, not CLI arguments/artifacts. Application principal has SELECT/INSERT/UPDATE/DELETE only on owned databases. DDL principal has database DDL privileges and PROCESS to observe only this synthetic instance's transaction isolation. No external DATABASE_URL is accepted by the runner.

Databases use `s1_<22-hex-nonce>_{lf,crlf,fault,recovery}` solely for compatibility with the frozen metadata helper. Manifest purpose and source remain W0. Fresh-instance inventory excludes non-system databases before mutation. Hostname or a caller target object proves only syntax; trusted GitHub service identity must be established by the future authority integration before entering the matrix.

Measure actual version, SQL mode, timezone/offset, isolation, engine and collation. Configure this disposable service to observed S0 SQL mode, latin1/latin1_swedish_ci defaults, REPEATABLE-READ and SYSTEM timezone; migration tables remain utf8mb4_unicode_ci/InnoDB. Actual per-transaction SERIALIZABLE is checked through INNODB_TRX, not inferred from a Prisma argument or the session default. Official MariaDB service does not prove cPanel/LVE or VinaHost production parity.

## Migration and fixtures

Apply historical four migrations from byte-verified derived trees to an empty owned DB; diff against the old schema. Seed legacy data using independently generated old Prisma 7.8.0 client. Expand in this exact order:

1. 20261008155242_cms011_review_foundation
2. 20261009003458_product_catalog_foundation
3. 20261009190000_cms_article_audience

LF variant uses all original LF payloads. CRLF variant derives only the first three historical migrations as CRLF, matching reconciled historical byte representations. The working-copy raw fingerprint is recorded separately; bytes are verified against the Git blob, explicitly converted to that LF payload and then passed to the unchanged S1 LF/CRLF helper. Originals and _prisma_migrations checksums are never rewritten. Verify initial four completed records, then final seven completed records and schema diff. Fault variant has a deliberate owned ArticleVersionCategory collision, verifies actual partial DDL and exactly four completed plus one expected failed migration. It is never retried, resolved or reversed. Recovery is a FRESH database with seven completed migrations, compared with LF schema. Final histories are reread after the entire matrix.

Legacy users/Articles/versions/review/classification/media metadata are synthetic. The W0-only derived legacy plan replaces underscores in synthetic Article slugs with hyphens before seeding/snapshot; this matches action normalization and prevents a false no-op/pointer failure. Original S1 fixture plans and historical version fields remain unchanged. No media files, CMS-009 root, sentinel, receipts or customer data. Fixtures create historical edges only inside isolated DB, not application review/publishing activation. Reuse constraintCases checks cross-Article version edges, duplicate edges, nullable links and RESTRICT for affected graph. Old/new clients are separately generated, never two names for one generated client.

## Runtime cases (all NOT_RUN at Checkpoint A)

| Cases | Observation |
| --- | --- |
| BASELINE / MIGRATION / LEGACY / MIXED_CLIENT | Real migrations/history/schema; legacy byte-normalized snapshots; old/new reads and writes |
| SAVE_NULL_PUBLIC / OMITTED_AUDIENCE | Real W0 create/update/query, persisted reopen and legacy omission |
| STALE_CAS / SERIALIZABLE / CONCURRENT_ACTIONS | Separate pools, distinct CONNECTION_IDs, synchronized persisted reads, both content/audience orderings, actual isolation, one winner, no mutation retry |
| ROLLBACK | Real write then injected callback exception; transaction rollback preserves content/audience/pointers |
| LOST_ACK | Real commit then response withheld; independent observer reconciles; exactly one action transaction |
| PAID_DENIED / INCONSISTENT_DENIED | Stored paid/edges fail closed; no overwritten data or implicit PUBLIC |
| ACTOR_SCOPE | Real persisted ACTIVE/role check, foreign ownership, missing session and non-editable status |
| POINTERS_HISTORY / CONSTRAINTS | No-op preserves pointers; meaningful edit clears active basis; history immutable; FK/restrict executes |
| PARTIAL_DDL / RECOVERY / FINAL_SCHEMA / FINAL_HISTORY | Expected failed history, observed partial columns, new-DB recovery and final evidence reread |

Action bridge adapts ONLY session acquisition and Next cache boundary; imports actual W0 modules and real roles/policies. AsyncLocalStorage separates simultaneous session contexts. All model operations forward to real Prisma; no mock database returns integration PASS. Browser authentication, Next POST/CSRF/cache behavior and client autosave UI remain NOT_RUN. Real fresh actor checks in actions are covered, not real login. Reopen query consumes a supplied actor exactly as production query does; this does not manufacture a fresh query-side authorization guarantee.

W0 lost-ACK result is currently INTERNAL_ERROR. The test never changes that to an invented UNKNOWN_OUTCOME response. The harness distinguishes deliberate post-commit ACK loss, reconciled through an independent DB read, from an unclassified failure, which stops. Neither injection proves loss of a real protocol packet. No automatic second save.

## Evidence, failure and cleanup

Evidence records use exact case IDs, safe codes and hashes only; no raw errors, SQL, bodies, credentials or sessions. Prisma stdout/stderr is captured and hashed, not forwarded. Fixed CMS_DRAFT diagnostic strings are not customer payloads. Journal INTENT precedes mutation; ACK follows; failure, missing ACK or persistence failure blocks subsequent operations. Hash chains detect tampering but do not authenticate a hostile OS or prevent filesystem races.

Only known complete, owned resources with closed connections qualify for disposal planning. SQL DROP/broad DELETE cleanup is not implemented. The only row delete in the test matrix is an exact synthetic ArticleProduct composite key, needed to test W0 pointer behavior. All fault/unknown databases remain logically preserved; GitHub still tears down job-scoped service resources on exit. Durable sanitized artifacts, not the ephemeral DB, are the retained recovery evidence. Do not imply a failed service survives runner teardown.

Artifact upload allowlist: manifest.json, results.json, metadata.json, history.json, journal.jsonl; bounded, hash-checked; never private-work or raw migration output. On unknown outcome: no retry, migrate resolve, broad cleanup or new run. Missing/failed cases prevent PASS. Review approval and actual run provenance are separate from offline test results.

## Offline validation and independent handoff

Run Node 22 prepared locally: `node --experimental-vm-modules --test tests/cms-w0-db-validation-safety.test.mjs`. Syntax-check the six .mjs files. Parse YAML and inspect trigger/job guard, ref pins, permissions and service isolation. Scoped ESLint may use the existing approved installation without npm install. Do not run the runtime matrix, Docker, images, migration CLI or live applications in this grant. The import audit uses real VM modules. With no outer VM flag, a bounded child uses process.execPath, fixed argv, shell:false and the same test-file hash, runs six explicit audit outcomes and registers no duplicate node:test cases. Parent rejects missing/failed/unknown outcomes, wrong version/hash/flag or incomplete controls; no SKIP or inferred PASS. Both outer-flag modes must be validated.

Claude 1 receives eight UNTRACKED files, full no-index diff, raw SHA-256, Git-normalized blobs, offline test logs, source/guard preservation and this scope. Review includes negative controls for environment/approval forgery, target drift, artifact/line-ending mismatch, hostile input, incomplete evidence, unknown outcomes and import side effects. Source REVIEW_PASS must come from Claude, not the author.

Stop at WAITING_REVIEW. Publication, protected authority wiring, image attestation, one DB execution and production release are separate future gates. No W0 review/unit rerun is needed absent source drift. Manual authenticated production UAT remains DEFERRED.
