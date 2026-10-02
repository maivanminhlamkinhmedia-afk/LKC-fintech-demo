# CMS-009 — local fixes after independent review

Date: 2026-09-30 (UTC+7). Branch `feature/cms-009-media-library`, HEAD `b68f83fd62dd105d12ed9fc1cb58f257289f8ff7`. All implementation changes remain **UNSTAGED**. This report supersedes the coverage and count statements in the initial [implementation checkpoint](CMS-009-implementation.md). Claude's findings and the staging plan were supplied by the Product Owner; all PASS results below are local Codex runs unless explicitly identified otherwise. Claude delta review, CI, guarded staging browser/MariaDB and production storage gates are **NOT RUN**. Manual authenticated production UAT remains **DEFERRED**.

## Fixes and evidence

| Finding | Change and assertion | Local result / limit |
|---|---|---|
| BUG-001 | `cms-media-actions.test.mjs` sets `NEXTAUTH_URL` to port 3001 inside the Origin/Host test, restores the inherited value (including absence) in `finally`, and runs that test without concurrency. Production Origin check is unchanged. | Three isolated, filtered subprocesses with outer URL 3000, 3001 and absent each passed **12/12** after all action-test additions. The negative Origin and bounded-byte assertions remain. |
| MED-26 | v4 exact `legacyMediaAssets` DB-only fixture journal, create/attach helpers, graph/reverse-reference checks, exact row cleanup; browser `MED_LEGACY_MEDIA` asserts warning, read-only controls, no selectable legacy radio, retain/no-op and clear with DB/reload/preserved fields. It records **attempts** to request `https://legacy.invalid/…` and requires zero. | Manifest/graph negative tests passed locally; browser case is **DISCOVERED, NOT RUN**. Legacy URL never grants file cleanup authority. |
| MED-07 | Adapter injects EACCES at the actual journal-create boundary with an existing synthetic root. | `INTERNAL_ERROR`, zero DB writes, exactly one root open, no fallback; missing-root test retained. |
| MED-25 | Real temp filesystem plus synthetic DB adapter call the actual `inspectRecovery`/`applyRecovery`. Completed no-op recovery now reports `applied:false`. | Recovery 8/8 focused PASS before final full suite; boundary table below. No age/PID lock takeover or orphan sweep. |
| MED-32 | Separate Node child lifetimes use the actual storage module and one OS-temp external root; assembled bundle smoke copies traced storage/contract module, worker and pinned codec packages into a separate OS-temp directory, then canonicalizes PNG and writes/reads its bytes in two child processes. | Two-process test 1/1 PASS; assembled smoke PASS (70 canonical bytes). These checks do not start HTTP, prove Linux/cPanel persistence, or use a real DB/auth session. |
| Assemble | Reproduction planted stale bytes and an extra file under a same-version codec destination. Assembly now replaces only the verified bundle codec directory and byte-compares the copied tree. A nested traced `server.js` selects its own runtime directory. A verified junction to the isolated snapshot's source modules is unlinked **as a link** before creating a real bundle directory. | Assembler regressions 3/3 PASS; source codec bytes survived junction case. The first local build exposed this junction hazard and failed; `pngjs@7.0.0` in ignored local `node_modules` was restored byte-for-byte (27 files) from the earlier assembled bundle, without a package install. The final build result appears below. |
| MED-03/08/16 | Invalid upload matrix includes empty/oversize/fake MIME-extension/unsupported/malformed/Origin and checks DB/object residue. A journaled 21-row managed batch exercises page 2, own/admin scope and selection. All ten fixture statuses and three owners attach one asset; denied delete preserves every edge/row before exact detach. | Browser cases discovered only; negative batch and v4 guard tests locally PASS. |
| MED-20 | Browser cases expire the session, suspend/change the user role, transfer a managed asset's uploader and change Article status/owner after form preload; they verify safe failure, input and DB preservation. The uploader transfer reserves exactly one alternate fixture creator in the v4 journal before DB CAS; graph inspection accepts only the original or reserved owner and cleanup scopes to the actual row. Local action and negative manifest/graph tests cover the same boundary. | Local action/negative checks PASS; browser cases discovered only. The guarded transfer/session cases remain staging pending. |
| MED-21 | A loopback Chromium probe mounts the **real `MediaLibrary` React component** under StrictMode with synthetic actions. It checks one update for double click, inverted search responses, and late search/save responses after unmount/reattach. Existing guarded browser case retains double-submit and responsive assertions. | Local Chromium probe PASS; staged browser cases NOT RUN. No dev CMS server, account or DB was used in the probe. |
| MED-23 | New guarded browser case drops a committed cover action ACK and asserts chosen radio/input, blocked state, committed DB token, preserved Article fields and reload. Existing metadata/delete lost-ACK cases remain. Action adapter injects unlink EACCES *after* confirmed DB delete and checks `storagePending:true`, absent row and unfinished journal. | Local storagePending test PASS; three lost-ACK browser cases discovered, NOT RUN. |
| MED-29 | Read-only graph reconciliation test compares manifest JSON, journal bytes, object bytes and four filesystem counters before/after inspection; its DB adapter has read methods only. | Local PASS. Guarded runner's real v4 reconciliation, cleanup and 19 zero counters remain staging pending. |

Package restoration provenance (documentation clarification at the commit checkpoint, **not** part of Claude's reviewed text): the Codex tool-call transcript records `Copy-Item` from the earlier assembled `pngjs@7.0.0` bundle and a subsequent 27-file byte/hash equality check. The persistent build log records the missing package but not the restoration command. The Product Owner reports that Claude described an npm-cache reinstall; no separate local log corroborating that method was found. This checkpoint did not install a package or repeat the build to settle the wording difference.

### Recovery boundary → test → invariant

| Boundary | Local fault/observation | Required invariant |
|---|---|---|
| Journal temp before rename | Temp journal alongside operation; check and apply both reject | No ambiguous journal consumed; temp, canonical bytes and persisted journal unchanged. |
| Upload `intent` / `dispatched` / `canonical-ready` / `file-ready`, no DB row | Stage matrix and exact receipt inspection | Only exact journaled orphan eligible; check-only does not write. |
| Canonical file present with committed DB row, including lost ACK | Synthetic committed row | Apply refuses unlink; bytes/digest remain. |
| DB unavailable or unexpected referenced Article | Adapter throws or returns foreign cover count | Recovery fails closed and leaves bytes/journal. |
| Delete row absent, file present after DB commit | `db-deleted` operation | Only exact digest file may be unlinked; journal advances to complete. |
| File already unlinked before delete `complete` stage | Fault between unlink and journal update | Apply completes the exact journal; second apply reports no work. |
| Active asset lock, even if old | Lock directory present | Check/apply refuse; lock and canonical bytes remain; no age/PID stealing. |
| Receipt/key drift | Modified bytes or mismatched identity | Apply rejects without broad orphan cleanup. |

## Current acceptance criteria mapping

`L` is local source/test evidence, `B` is a guarded Playwright case in discovery only, and `P` is an external pending gate. Local synthetic tests do not claim a staging MariaDB or production result.

| AC | Evidence/state | AC | Evidence/state |
|---|---|---|---|
| 01 | L: media scope, schema/editor/role unchanged | 21 | L+B: guarded cover route/editability |
| 02 | L+B: protected pages/actions/byte route | 22 | L+B: Article CAS/preserved fields |
| 03 | L+B: own/admin/current-cover scope | 23 | L+B: no-op/token/current cover |
| 04 | L: strict DTO, Unicode, safe errors | 24 | L+B: shared token, one winner; MariaDB P |
| 05 | L+B: bounded stream/full decode/invalid matrix | 25 | L+B: source/classification shared token; MariaDB P |
| 06 | L+B: canonical PNG/JPEG orientation/metadata | 26 | L: real React lifecycle probe; B discovery |
| 07 | L: byte/pixel/worker deadline/slot | 27 | L+B: metadata/cover/delete unknown ACK |
| 08 | L: exact codecs and assembled smoke | 28 | L+B: deterministic invalid vs unknown |
| 09 | L+B: Origin/Host check, test env isolation | 29 | L+B: guarded editor/source/classification links |
| 10 | L: missing and EACCES root; provision P | 30 | L+B: labels, focus, responsive controls |
| 11 | L: private path/link/digest guards | 31 | L: v4 exact DB+FS inventory; staging P |
| 12 | L+B: journal/lock before side effect | 32 | L: v1–v3 cannot gain media authority |
| 13 | L+B: same-operation replay/status | 33 | L: cleanup code/tests; 19-zero staging P |
| 14 | L+B: DB-before-unlink, pending storage | 34 | L: two-process/assembled local; cPanel P |
| 15 | L+B: all-cover count/status-owner matrix | 35 | L: filtered dummy env/diagnostic guards |
| 16 | L+B: lock/CAS concurrency; MariaDB P | 36 | L: 90 baseline discovery; browser P |
| 17 | L+B: scoped deterministic paging | 37 | L: full unit/action suite; browser P |
| 18 | L+B: protected GET/HEAD and headers | 38 | L: no real DB/SSH; check-only no-write |
| 19 | L+B: metadata CAS/immutable identity | 39 | DEFERRED: manual authenticated UAT |
| 20 | L+B: legacy read-only/current cover | 40 | P: Claude delta review → CI → staging → release |

## MED-01..36 scenario mapping

All MED browser cases below are **discovery only** in this local turn. MED-04/06/07/25/30/31/32 are L-only by specification; the other 29 require guarded browser execution later.

| MED | Evidence at this checkpoint | MED | Evidence at this checkpoint |
|---|---|---|---|
| 01 | L auth/scope + B access | 19 | L metadata CAS + B metadata |
| 02 | L codec/storage + B upload/bytes | 20 | L fresh role/uploader + B role/status/uploader/owner |
| 03 | L validation + B invalid matrix | 21 | L actual React Chromium lifecycle + B double-submit/layout |
| 04 | L hostile DTO/Unicode/token | 22 | L same-operation + B lost upload ACK |
| 05 | L orientation/strip + B canonical upload | 23 | L storagePending + B three lost ACK paths |
| 06 | L worker limits/termination | 24 | L safe failures + B offline/cancel/invalid |
| 07 | L missing root + EACCES | 25 | L real-FS recovery boundary matrix |
| 08 | L scoped query + B page 2/own/admin | 26 | L v4 fixture guards + B legacy retain/clear |
| 09 | L token precision + B metadata | 27 | L navigation guards + B editor links |
| 10 | L private content + B GET/HEAD/XSS | 28 | L component a11y + B viewport checks |
| 11 | L scoped read + B foreign/current cover | 29 | L no-write inventory + B guarded reconciliation |
| 12 | L cover CAS + B select/clear | 30 | L legacy manifest rejection |
| 13 | L no-op/preserved + B replace/clear | 31 | L digest/identity/diagnostic forgery guards |
| 14 | L one-winner CAS + B simultaneous writes | 32 | L two process lifetimes + assembled smoke |
| 15 | L shared token + B source/classification races | 33 | L exact cleanup tests + B 19 counters pending |
| 16 | L all-cover count + B 10-status/3-owner matrix | 34 | L +1ms precision + B persisted tokens |
| 17 | L DB-first delete + B unused/cancel | 35 | L 90 baseline discovery + B regression pending |
| 18 | L lock order + B attach/delete race | 36 | L guarded protocol + B fresh VERIFIED pending |

## Validation and review handoff

### Exact working-tree file inventory

Content-modified tracked paths (the pre-existing CMS-009 implementation plus this delta):

```
docs/cms/ROADMAP.md
docs/cms/operations/cms009-media-storage.md
package-lock.json
package.json
scripts/cms-e2e/cleanup.mjs
scripts/cms-e2e/diagnostics.mjs
scripts/cms-e2e/fixtures.mjs
scripts/cms-e2e/run.mjs
scripts/cms-e2e/taxonomy-fixtures.mjs
src/app/creator/articles/page.tsx
src/app/creator/page.tsx
src/features/cms/components/ArticleClassificationPanel.tsx
src/features/cms/components/ArticleDraftForm.tsx
src/features/cms/components/ArticleSources.tsx
tests/README.cms-e2e.md
tests/cms-e2e-diagnostics.test.mjs
tests/cms-e2e-harness.test.mjs
tests/cms-taxonomy-recovery-cost.test.mjs
tests/e2e/cms-sources.spec.ts
tests/e2e/cms-taxonomy.spec.ts
```

New, untracked paths:

```
docs/cms/reports/CMS-009-implementation.md
docs/cms/reports/CMS-009-review-fixes.md
scripts/cms-e2e/media-fixtures.mjs
scripts/cms-media/assemble-standalone.mjs
scripts/cms-media/recover.mjs
scripts/cms-media/smoke-standalone.mjs
src/app/api/cms/media/[id]/content/route.ts
src/app/api/cms/media/uploads/[operationId]/route.ts
src/app/creator/articles/[id]/media/page.tsx
src/app/creator/media/page.tsx
src/features/cms/components/ArticleCoverPanel.tsx
src/features/cms/components/MediaLibrary.tsx
src/features/cms/media-actions.ts
src/features/cms/media-codec-worker.cjs
src/features/cms/media-codec.ts
src/features/cms/media-contract.ts
src/features/cms/media-http.ts
src/features/cms/media-query.ts
src/features/cms/media-storage.ts
src/features/cms/media-store.ts
tests/browser-local/cms-media-lifetime-child.mjs
tests/browser-local/cms-media-ui-lifecycle.mjs
tests/cms-e2e-media-harness.test.mjs
tests/cms-media-actions.test.mjs
tests/cms-media-assemble-standalone.test.mjs
tests/cms-media-codec.test.mjs
tests/cms-media-contract.test.mjs
tests/cms-media-process-lifetime.test.mjs
tests/cms-media-recovery.test.mjs
tests/cms-media-storage.test.mjs
tests/cms-media-worker-runner.test.mjs
tests/e2e/cms-media.spec.ts
```

`next.config.ts` still appears as `M` in Git status from the inherited line-ending presentation, but its Git-normalized blob equals HEAD and `git diff -- next.config.ts` is empty. It was not restored or edited for the review fix.

All local subprocesses used Node `v22.23.2` through the existing filtered `.next/cms006-local-20260926-05e7d1/run.cjs` wrapper: allowlisted OS variables, dummy DB/auth, `.env` read guard and blocked DB ports. The browser lifecycle server bound loopback only. No real DB, SSH, staging, fixture cleanup or migration was run.

| Gate | Actual result |
|---|---|
| BUG-001 three outer `NEXTAUTH_URL` values | PASS: **12/12 each** (3000, 3001, absent), after all action-test additions. |
| Focused recovery / assembler / independent process | PASS: recovery 8/8, assembler 3/3, two-process storage 1/1. |
| Actual React Chromium lifecycle | PASS: StrictMode, single flight, response inversion and disposed search/save responses; Chromium 153.0.8010.12. |
| Full unit/action suite | **838/838 PASS**, 0 fail/skip, Node 22.23.2. |
| `npm run lint` / TypeScript | PASS, Node 22.23.2. |
| Prisma validate/generate | NOT RERUN: delta has no Prisma/schema/DB changes; previous local implementation gate PASS. |
| Isolated production build | PASS: `npm run build`, 182 hashed inputs, zero source/hash mismatches, `build-snapshot-review4`, `CMS_MEDIA_STANDALONE_READY worker=1 codecs=2`. |
| Assembled worker/storage smoke | PASS on final `build-snapshot-review4` artifact: traced worker/codecs, canonical PNG (70 bytes), two child-process storage lifetimes. |
| Playwright discovery | PASS: **122 = 90 baseline + 32 MED**; guarded browser callbacks NOT RUN. |
| `git diff --check` / new-file marker scan | PASS; 32 untracked text files scanned with zero trailing-whitespace/conflict-marker findings. Git's LF→CRLF notices are normalization warnings, not diff errors. |

Final Git checkpoint: HEAD unchanged at `b68f83fd62dd105d12ed9fc1cb58f257289f8ff7`; 20 tracked content modifications plus the inherited status-only `next.config.ts`, 32 untracked implementation/test/report files, zero staged files. No commit, push, PR, real fixture operation or cleanup was performed.

The implementation delta changes media actions tests, recovery, assembler, v4 fixture/cleanup helpers, diagnostics, guarded media scenarios and the local browser/process/standalone probes. The new browser cases are assertions awaiting execution, not staging PASS. The key Claude delta-review targets are (1) exact legacy DB-only cleanup authority and reverse references, (2) matrix/paging/uploader fixture interruption recovery, (3) assembler junction handling and standalone packaging, and (4) React lifecycle probe fidelity. CMS-009 is **NOT COMPLETE**.
