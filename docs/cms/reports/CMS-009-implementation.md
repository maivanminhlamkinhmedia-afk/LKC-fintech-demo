# IMPLEMENTATION REPORT — CMS-009 (local checkpoint)

> Post-review delta: [CMS-009 review fixes](CMS-009-review-fixes.md) records the current AC/MED mapping and validation. Counts and identified gaps below describe the earlier implementation checkpoint and must not be used as current results. Claude's independent review findings were supplied by the Product Owner; this delta still awaits independent review, CI and guarded browser staging.

Date: 2026-09-30 (UTC+7). Branch `feature/cms-009-media-library`; document HEAD `b68f83fd62dd105d12ed9fc1cb58f257289f8ff7`, parent/main baseline `89269dc806a9800f6582ea1a37a909aa60c944cd`. Implementation is **UNSTAGED**. This is local engineering evidence, not Claude review, CI, browser staging, storage provision, or release approval. Manual authenticated UAT remains **DEFERRED**.

## Implementation and file inventory

The editor schema, Prisma schema/migrations, role matrix and deploy workflow are unchanged. New private media routes use existing `MediaAsset` and `Article.coverMediaId` fields. Library and cover pages require CMS access; actions and byte endpoints recheck the session against a fresh ACTIVE user and scope assets by uploader for CREATOR or all managed assets for ADMIN/SUPER_ADMIN. A creator may read another uploader's asset only while it is the current cover of a readable own Article; this does not grant library/mutation/selection rights. Legacy rows display escaped metadata without loading their stored URL or adopting their file.

PNG/JPEG upload accepts a raw bounded stream after fresh auth, exact operation ownership, and canonical `NEXTAUTH_URL` Origin comparison. A pure-JS worker validates signature/structure/dimensions and full decode, normalizes JPEG EXIF orientation, then re-encodes pixels to drop metadata and trailing payload. Inputs and canonical outputs are capped at 5 MiB; dimensions ≤4096 and pixels ≤4,194,304. The worker deadline is 15 seconds with termination, and the process permits one active codec job, returning `MEDIA_BUSY` for another. `resourceLimits` supplement explicit byte/pixel/decoder limits; they are not the only memory guard.

`CMS_MEDIA_ROOT` is explicit, private, absolute and outside the checkout for production. Local/staging roots require explicit provisioning; import, build and metadata reads do not create storage. The adapter checks marker/realpath, exact canonical keys, regular files, one link and digests. The staging runner provisions an exclusive `.next/cms-e2e-media/<runId>` root and overrides inherited root values. Windows local tests and standalone smoke do **not** prove production root ACL, proxy body limits, backup or Linux runtime.

The DB/filesystem boundary is journaled; no atomic DB+FS claim is made:

| Operation | Durable stage before next side effect | Commit/unknown behavior |
|---|---|---|
| Upload | `intent` → `dispatched` → `canonical-ready` → `file-ready` → DB create → `committed` | Same operation status/replay reads exact row and returns one asset. Lost DB ACK retains file/journal; no blind new ID or compensating unlink. Known bad image before file/DB becomes `abandoned` and keeps a receipt. |
| Delete | `intent` → `dispatched` → Serializable row lock/all-cover count/CAS delete → `db-deleted` → exact digest unlink → `complete` | Used/stale/forbidden precommit becomes `rejected`. Uncertain commit keeps file/journal. Confirmed row deletion with failed unlink reports `storagePending`; check-only recovery is default. |
| Cover | Asset lock and `FOR UPDATE`, then Article scope/editability/schema check and shared `updatedAt` CAS in Serializable TX | No-op checks token/permission. Cover mutation never rewrites body, source or classification. Concurrent autosave/source/classification uses the same Article token. |
| Metadata | Fresh actor, exact MediaAsset token, updateMany and persisted read-back in Serializable TX | Only alt/caption/token change; uploader and binary identity remain immutable. Stale token does not auto-refresh and retry. |

Upload intents expire after 30 minutes only before dispatch, quota is four pending per actor under an exclusive actor lock; dispatched/unknown receipts are not pruned by TTL. The maintenance entrypoint `scripts/cms-media/recover.mjs` defaults to check-only; `--apply` requires exact operation/actor/asset/key and DB/root identity confirmation. It never runs as part of normal web requests. See [storage runbook](../operations/cms009-media-storage.md) for actual flags, phase outcomes and release gates.

Changed tracked files:

`docs/cms/ROADMAP.md`, `docs/cms/operations/cms009-media-storage.md`, `package.json`, `package-lock.json`, `scripts/cms-e2e/{cleanup,diagnostics,fixtures,run,taxonomy-fixtures}.mjs`, `src/app/creator/{page,articles/page}.tsx`, `src/features/cms/components/{ArticleClassificationPanel,ArticleDraftForm,ArticleSources}.tsx`, `tests/README.cms-e2e.md`, `tests/{cms-e2e-diagnostics,cms-e2e-harness,cms-taxonomy-recovery-cost}.test.mjs`, `tests/e2e/{cms-sources,cms-taxonomy}.spec.ts`.

New files:

`scripts/cms-e2e/media-fixtures.mjs`, `scripts/cms-media/{assemble-standalone,recover}.mjs`, `src/app/api/cms/media/[id]/content/route.ts`, `src/app/api/cms/media/uploads/[operationId]/route.ts`, `src/app/creator/articles/[id]/media/page.tsx`, `src/app/creator/media/page.tsx`, `src/features/cms/components/{ArticleCoverPanel,MediaLibrary}.tsx`, `src/features/cms/{media-actions,media-codec-worker,media-codec,media-contract,media-http,media-query,media-storage,media-store}.{ts,cjs}` as named on disk, `tests/{cms-e2e-media-harness,cms-media-actions,cms-media-codec,cms-media-contract,cms-media-recovery,cms-media-storage,cms-media-worker-runner}.test.mjs`, `tests/e2e/cms-media.spec.ts`, this report.

Minimal exact pins installed after npm metadata/license/engines/peer/security checks: `pngjs@7.0.0`, `jpeg-js@0.4.4`, `@types/pngjs@6.0.5` (dev). `pngjs` is MIT/Node≥14.19/no peers; `jpeg-js` is BSD-3/zero dependencies. The known `jpeg-js` advisory is fixed in 0.4.4. No Next/React/Prisma/TipTap/Playwright pins changed; no native sharp requirement. The lockfile contains these resolution deltas. References checked: [npm pngjs](https://www.npmjs.com/package/pngjs), [npm jpeg-js](https://www.npmjs.com/package/jpeg-js), [GitHub advisory](https://github.com/advisories/ghsa-xvf7-4v9q-58w6). Package audit still reports pre-existing tree advisories; no newly selected codec advisory was identified by this gate.

The isolated build exposed a Turbopack boundary: `require.resolve` for a Worker is compiled to a numeric module ID, which is not a valid Worker path. The final `media-codec.ts` instead resolves `src/features/cms/media-codec-worker.cjs` from the standalone server's working directory; the generated `server.js` calls `process.chdir(__dirname)`. The `npm run build` postbuild step copies that exact worker and the two pinned runtime codec packages into `.next/standalone` and verifies the copies. An OS-temp smoke executed the copied worker and packages without the development source tree. This is a local packaging check, not a Linux/cPanel run.

## Manifest v4 and legacy regression

v4 keeps v3 ownership/catalog/source graph and adds exact root identity, upload/delete intents, historical asset receipts, Article cover edges and object/temp/journal/lock inventory. Lost begin-upload ACK recovery accepts only a valid journal in the fresh root from an exact fixture actor, then validates the complete batch before writing manifest additions. Reverse checks reject a foreign Article referring to fixture media and a fixture Article referring to foreign media. Unknown file/path, digest drift, symlink/hardlink, active lock, missing row without delete proof and unknown kind fail closed. No source-level assertion was removed from the 90 EDIT/AUTO/SRC/TAX baseline; old fixture tests now pin v1/v2/v3 explicitly instead of inheriting the v4 default. TAX-08 and TAX-10/11 keep 120s; other tests retain 60s, expect 10s, worker 1/retries 0.

Cleanup preflights DB and filesystem before any destructive operation. It clears exact cover edges and owned DB rows inside the existing guarded transaction, checks 15 DB counters in-transaction and postcommit, then verifies exact file digests again before unlink and checks four filesystem counters. Required zero counters are `articles, profiles, users, logs, sources, categories, topics, tags, instruments, categoryLinks, topicMappings, tagMappings, articleInstruments, mediaAssets, coverLinks, mediaFiles, mediaTempFiles, mediaJournals, mediaLocks`. DB zero alone cannot emit `CMS_E2E VERIFIED`. Staging cleanup has **not** run on this implementation.

## Acceptance Criteria mapping

`LOCAL` means a local test/build/source check passed. `B DISCOVERY` means browser case exists but callback has not run. `PENDING` is an external/release gate. The source and local tests listed here are review targets, not proof of MariaDB or cPanel behavior.

| AC | Evidence / state |
|---|---|
| 01 | LOCAL: PNG/JPEG scope; schema, roles and editor v1 unchanged. |
| 02 | LOCAL: pages, actions, query and API fresh auth checks; MED-01 B DISCOVERY. |
| 03 | LOCAL: own/admin scope and narrow current-cover read in `media-store`; MED-08/11 B DISCOVERY. |
| 04 | LOCAL: exact own-data descriptor/Unicode/token/safe-error tests in `cms-media-contract.test.mjs`. |
| 05 | LOCAL: bounded raw reader and full worker decode; MED-02/03 B DISCOVERY. |
| 06 | LOCAL: PNG alpha/JPEG orientation/trailing payload probes; MED-05 B DISCOVERY. |
| 07 | LOCAL: input/pixel/output limits plus real hung/crashed worker termination and single-flight regression. |
| 08 | LOCAL: exact pins, isolated build and assembled standalone worker smoke PASS. |
| 09 | LOCAL: canonical Origin/Host mismatch and stream tests; MED-02 B DISCOVERY. |
| 10 | LOCAL: missing root fail-closed/explicit provision test; production provision PENDING. |
| 11 | LOCAL: random key and path/symlink/hardlink/digest tests. |
| 12 | LOCAL: journal/lock tests; MED-22 B DISCOVERY. |
| 13 | LOCAL: same-operation status/replay code, recovery tests; MED-22 B DISCOVERY. |
| 14 | LOCAL: DB-before-unlink code/recovery tests; MED-17/23 B DISCOVERY. |
| 15 | LOCAL: all-cover count without status/owner filter; MED-16 B DISCOVERY (browser status matrix not executed). |
| 16 | LOCAL: same asset lock + `FOR UPDATE` ordering; MED-18 B DISCOVERY; MariaDB PENDING. |
| 17 | LOCAL: bounded scoped deterministic query; MED-08 B DISCOVERY. |
| 18 | LOCAL: protected GET/HEAD, digest and private headers; MED-02/11 B DISCOVERY. |
| 19 | LOCAL: metadata CAS/no-op/+1ms/immutable fields tests; MED-09 B DISCOVERY. |
| 20 | LOCAL: legacy DTO/read-only/current-cover retain/clear test; dedicated legacy browser fixture not added. |
| 21 | LOCAL: editable/supported Article checks, link only after create; MED-01/12 B DISCOVERY. |
| 22 | LOCAL: Article CAS only cover/token; MED-12/13 B DISCOVERY. |
| 23 | LOCAL: cover no-op/token test; MED-12/13 B DISCOVERY. |
| 24 | LOCAL: one-winner shared token test; two MED-14 B DISCOVERY. |
| 25 | LOCAL: shared token source/classification paths; four MED-15 B DISCOVERY. |
| 26 | LOCAL: single-flight/generation/dispose code; MED-21 B DISCOVERY; race execution PENDING. |
| 27 | LOCAL: unknown-ACK barriers in clients; MED-23 B DISCOVERY. |
| 28 | LOCAL: deterministic validation/abandoned journal vs unknown; MED-03/24 B DISCOVERY. |
| 29 | LOCAL: links into existing guarded editor/source/classification routes; MED-24/27 B DISCOVERY. |
| 30 | LOCAL: labels/error focus/layout code; MED-21/28 B DISCOVERY. |
| 31 | LOCAL: v4 ownership/inventory/reverse-ref tests; 19-counter staging PENDING. |
| 32 | LOCAL: v1/v2/v3 fixture version regression and rejection tests. |
| 33 | LOCAL: guarded cleanup path/tests; real 19-zero+VERIFIED PENDING. |
| 34 | LOCAL: isolated assembled worker smoke; external root restart/redeploy and Linux release PENDING. |
| 35 | LOCAL: filtered dummy env and forged diagnostic record test. |
| 36 | LOCAL: 90 baseline test inventory retained; 116 discovery; full browser baseline PENDING. |
| 37 | LOCAL: 825 unit/action tests, mapping below; browser cases only discovered. |
| 38 | LOCAL: no real DB/SSH/production accessed; check-only recovery regression. |
| 39 | DEFERRED: manual authenticated UAT is not claimed PASS or COMPLETE. |
| 40 | PENDING: Claude review → CI → guarded staging → production storage gate → release. |

## MED-01..36 scenario mapping

There are 29 scenarios designated L+B and seven L-only (`04/06/07/25/30/31/32`). `B` below means the corresponding Playwright case is in the 116-case discovery; **none has browser execution evidence**. Some broader B requirements remain only partially encoded and are called out for review; discovery must never be reported as staging PASS.

| MED | Local and browser coverage at this checkpoint |
|---|---|
| 01 | Fresh RBAC tests; MED-01 B. |
| 02 | Codec and storage tests; MED-02/05/10 B. |
| 03 | Validation/stream tests; MED-03/24 B currently checks oversize and origin replay, not every malformed browser input. |
| 04 | Hostile descriptor/getter/symbol/Unicode/token local contract tests. |
| 05 | PNG/JPEG orientation/metadata local probe; MED-02/05/10 B. |
| 06 | Worker resource limits/local header/invalid probes; hung-worker deadline, crash and post-failure slot recovery PASS. |
| 07 | Missing root local test; unwritable root case not separately exercised on Windows. |
| 08 | Scoped query local; MED-08/11 B, paging beyond first page local-only. |
| 09 | CAS/no-op local; MED-09/19/34 B. |
| 10 | Protected content local code; MED-02/05/10 and MED-10-XSS B. |
| 11 | Read scope local; MED-08/11 and MED-11-COVER B. |
| 12 | Cover CAS local; MED-12/13 and MED-12/13-REPLACE B. |
| 13 | No-op/preserved fields local; MED-12/13-REPLACE B. |
| 14 | Shared token one-winner local; two MED-14 B. |
| 15 | Shared token source/classification source; four MED-15 B. |
| 16 | All-cover count local; MED-16 B uses a draft, not the full status/owner matrix. |
| 17 | DB-before-file delete source; MED-17 and MED-17-CANCEL B. |
| 18 | Asset lock/row lock local evidence; MED-18 B. |
| 19 | Metadata CAS local; MED-09/19/34 B. |
| 20 | Fresh actor/scope local; MED-20 B covers role/status, not uploader reassignment. |
| 21 | Client single-flight/generation code; MED-21 and MED-21/28 B; search ordering/dispose not separately browser-probed. |
| 22 | Same-operation status local source; MED-22 B. |
| 23 | Unknown outcome UI; MED-23-METADATA/DELETE B; cover lost ACK not separately browser-probed. |
| 24 | Known invalid vs unknown code; MED-03/24 and MED-24/27 B. |
| 25 | Local recovery/fault tests for receipt drift, DB uncertainty and locks; not every crash boundary injected. |
| 26 | Legacy read-only/retain/clear local action test; dedicated B case absent. |
| 27 | Existing autosave guard links; MED-24/27 B. |
| 28 | UI labels/responsive source; MED-21/28 B. |
| 29 | V4 read-only graph and check-only CLI tests; guarded runner B path pending. |
| 30 | Legacy manifest rejection, invalid identity/reverse-ref local tests. |
| 31 | Storage/harness/diagnostic forged-record local tests. |
| 32 | Assembled worker and codec packages in OS temp PASS; real two-process root restart and Linux pending. |
| 33 | Local harness ownership/cleanup tests; real DB+FS 19 counters B PENDING. |
| 34 | Persisted +1ms metadata/Article token local; MED-09/19/34 B. |
| 35 | 90 baseline unit/discovery unchanged; browser baseline PENDING. |
| 36 | Guarded run protocol implemented; fresh real run/VERIFIED PENDING. |

## Local validation and limits

All subprocesses used Node `v22.23.2` through the existing filtered `.next/cms006-local-20260926-05e7d1/run.cjs` wrapper: allowlisted environment, dummy `DATABASE_URL`, `.env` read guard and blocked DB ports. Prisma used ignored dummy config `.next/cms008-local-20260929/prisma.config.ts`. No local command queried a real DB or read `.env`/secrets. Scratch build snapshots/logs under ignored `.next/cms009-local-20260930` are not implementation files.

| Gate | Actual result |
|---|---|
| Focused contract/codec/storage/action/recovery/harness/diagnostics | PASS; targeted runs include action 8/8, recovery+harness 8/8, media/legacy harness 40/40, codec 4/4, diagnostics 24/24. |
| Full `npm run test:unit` | **825/825 PASS**, 0 fail/skip, Node 22.23.2, after the final worker path change. Focused worker deadline/crash regression 2/2 PASS. |
| Prisma validate/generate (dummy config) | PASS; Prisma Client 7.8.0 generated. No migrate/db push/seed. |
| `npm run lint` | PASS, 0 warnings after final source changes. |
| `tsc --noEmit --incremental false` | PASS after final source changes. |
| Isolated `npm run build` | PASS; 182 input files, source hash mismatches 0, `build-snapshot-final6`; postbuild reported `CMS_MEDIA_STANDALONE_READY worker=1 codecs=2`. |
| Assembled standalone codec | PASS: copied worker and pinned packages ran from OS temp outside development source; synthetic 1×1 PNG re-encoded, 70 canonical bytes. Generated route chunk contains `resolve(process.cwd(), "src", "features", "cms", "media-codec-worker.cjs")`, not a numeric Worker argument. |
| Playwright discovery | **116 = 90 baseline + 26 MED**, PASS; browser NOT RUN. |
| `git diff --check` and untracked whitespace/conflict scan | PASS; 26 untracked text files scanned, zero trailing whitespace/conflict markers/missing final newline. |

No staging browser, MariaDB concurrency/precision, production root ACL/proxy/backup, SSH, fixtures or real cleanup was run. Claude independent review, CI and staging are **NOT RUN**. Review should prioritize the missing MED browser breadth (especially 03/16/21/23/26), remaining DB/FS crash boundaries, recovery apply protocol, operator storage gate, and any Node/Linux tracing difference. These are not marked PASS by local discovery/build. CMS-009 is **not COMPLETE**.

Final working tree/index checkpoint: all implementation/test/docs remain **UNSTAGED**; index empty. `git status --short --untracked-files=all` showed 20 tracked content changes, 26 untracked files, plus `next.config.ts` as a status-only `M`: `git diff -- next.config.ts` is empty and its working blob hash equals `HEAD:next.config.ts` (`4d0d963d45e57b949a3add6a600832ce14efbce6`). Branch/HEAD remain `feature/cms-009-media-library` / `b68f83fd62dd105d12ed9fc1cb58f257289f8ff7`, ahead/behind 0/0. Nothing was staged, committed or pushed.
