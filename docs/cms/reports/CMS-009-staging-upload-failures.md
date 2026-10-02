# CMS-009 — staging upload failures: local investigation and delta handoff

Date: 2026-10-01 (UTC+7). Branch `feature/cms-009-media-library`, unchanged HEAD
`23488bd6bdef20f6991f2d0826112f31b6094c03` (parent
`b68f83fd62dd105d12ed9fc1cb58f257289f8ff7`). PR #24 remains draft.
All changes in this report are **UNSTAGED**. The QA checkout
`D:\lkc_phase1_rbac_patch\cms009-qa-checkout-23488bd6` and its evidence were read
only. No production/staging DB, SSH, fixture, cleanup, migration, package install,
or dependency write occurred during this investigation.

## Result and evidence boundaries

The staging evidence below was produced by Claude and supplied by the Product
Owner; Codex did not run staging. The earlier `e8b4bb27efc39671f23961b3`
stopped at `DUMMY_BUILD_FAILED` before DB/fixtures/browser because Turbopack
rejected a junction crossing its root. This is a separate historical build
failure, not an upload verdict.

The browser run `5201c31a5356531f16d53e2b` used BUILD_ID
`JFt9iLJSumL6z4LV5iKcR` at the tested commit above. It ended **98 passed,
23 failed, 1 timedOut**, with 20 EDIT, 16 AUTO, 19 SRC, and 35 TAX passed;
MED was 8 passed, 23 failed, 1 timedOut. The first failing case was
`MED-08/11` in `MED_SCOPE_SEARCH`, timedOut. The surviving summary has no
assertion location or subphase timing for it. Later media cases often failed
inside `upload()` while waiting for the success status at the former line 74.
The run emitted `CMS_E2E STOP BROWSER_SUITE_FAILED`, exit 1, and no
`CMS_E2E VERIFIED` marker. Its runner verified all 15 DB and 4 filesystem
cleanup counters as zero; Claude also independently inspected four empty
filesystem directories. That cleanup result does not turn the suite into PASS.

Codex inspected the QA checkout read-only: detached HEAD matches the tested
commit; index/status were empty. Its surviving v4 manifest had 26 upload
intents and 25 tracked managed assets: two canonical PNG/JPEG uploads, one
malformed intent without an asset, one scope upload, 21 pagination batch
assets, and one later admin upload. The operation directory is now empty after
cleanup, so the manifest does **not** reveal the stage, response, lock, or
elapsed time of each operation when a test failed. In particular, the scope
asset's appearance in the manifest shows eventual DB/graph recovery, not that
the browser saw a timely success response.

## Pipeline inspection and findings

`MediaLibrary` retains the selected File through a known begin failure. Its
upload path invokes `beginMediaUpload`, then raw `fetch` POST, then parses the
response, reports known invalid-image errors, or blocks on unknown outcome.
Only a confirmed POST success sets the success status and refreshes the list.
The action validates metadata and fresh actor, opens the private root, takes
the actor lock, enforces four pending intents, and persists an upload intent.
The guarded browser interceptor validates that intent, persists exact
ownership in the manifest, then calls `route.continue()` for the real POST.
The Route Handler checks fresh auth and canonical Origin before bytes, takes
the operation lock, reads bounded bytes, runs the worker, publishes canonical
file/journal, creates the DB row, advances the committed receipt, and replies.
The guarded test later reconciles the manifest and reads the DB row. After
each case it closes contexts and runs graph recovery. No test assertion was
removed and the route transport remains `route.continue()`.

| Hypothesis | Local evidence and conclusion |
|---|---|
| **Pagination fixture exhausts creator's pending quota after a confirmed DB create** | **CONFIRMED structural bug.** `seedManagedMediaBatch` made 21 rows and left each upload receipt at `file-ready`; `countPendingMediaIntents` counts that stage, while `beginMediaUpload` rejects at four. The passing `MED-08-PAGE` precedes the later creator cases in the spec; the surviving manifest contains those 21 page assets and only one later admin asset. This deterministically prevents a later creator begin while the receipts remain, and explains a major failure chain, but the removed staging journals prevent assigning every individual failure to it retrospectively. |
| First `MED-08/11` timeout | **UNDETERMINED.** This case uploads as creator before opening `other` and `admin` contexts and before the pagination batch. Only `MED_SCOPE_SEARCH` timedOut is preserved. It cannot be caused by the later 21-row batch. The eventual scope asset does not prove timely UI ACK or locate the timed-out wait. |
| Worker slot left active after PNG/JPEG/malformed input | **Not reproduced locally; staging remains undetermined.** The actual worker runner accepted PNG, JPEG, then malformed input produced `UNSUPPORTED_MEDIA`, followed by six valid PNG jobs in sequence. Existing hang/crash termination tests also passed. This does not measure the staging worker/process. |
| Missing success status always means no DB write or a bad locator | **Not supported.** The QA manifest includes the scope asset despite timeout. A loopback Chromium probe mounted the real `MediaLibrary` with synthetic actions: `MEDIA_BUSY` left the File in place and sent no POST; a synthetic successful POST displayed the same success status locator. This probe does not test real Server Action transport, server response, or MariaDB. |
| Filesystem lock, tunnel/MariaDB, QA dependency layout | **UNDETERMINED** from the retained first-failure evidence. Final empty directories/zero counters exclude leftover artifacts after cleanup, not an in-run delay or error. The prior junction build failure is separate from this browser run. |

## Patch and before/after regression

The minimal functional fix is in the **test-only pagination fixture**. After
`createMany` acknowledges the exact row count, it writes each `committed`
receipt to an exclusive temporary journal, fsyncs it, and renames it over the
prior receipt. A thrown or unacknowledged DB write leaves `file-ready` for
guarded recovery; it is never marked committed optimistically. The optional
`cwd` argument only lets the same fixture run against a synthetic scratch
root; staging keeps the existing default. Product media code, quota, worker,
route, UI, auth, storage guards, and schema are unchanged.

The new regression calls the real `countPendingMediaIntents` against the
fixture's real temporary filesystem. **Before** the stage fix, four
acknowledged fixture rows yielded `actual 4` pending versus expected zero
(focused run exit 1). **After**, the same test passed, all four receipts were
`committed`, and pending was zero. A separate injected DB ACK loss kept its
receipt `file-ready` and pending count one. This is synthetic DB behavior,
not MariaDB staging evidence.

The first timeout needs another data point, so safe diagnostics now record
Node-clock phase start/end and duration for the upload helper, exact intent
reservation/forwarding, POST response status and an allowlisted error code if
available, a safe UI error code on failure, success UI, recovery, DB check,
media test-step timing, and
teardown. `MED-08/11` is split into creator upload, other-scope, and admin
scope substeps without changing operations or assertions. The reporter and
runner filter validate exact case/phase/fields and discard forged or unknown
fields. No raw response, request data, filename, metadata, URL, header,
cookie, token, SQL error, private path, trace, video, screenshot, or
storageState is emitted. An absent response or error code remains absent;
diagnostics do not fabricate one or convert failure to PASS.

## Files changed

| File | Purpose |
|---|---|
| `scripts/cms-e2e/media-fixtures.mjs` | Advance acknowledged pagination receipts, preserve unknown-ACK state, allow scratch cwd in local regression. |
| `tests/cms-e2e-media-harness.test.mjs` | Real quota before/after and DB ACK-loss regressions. |
| `tests/cms-media-worker-runner.test.mjs` | Real PNG/JPEG/malformed/six-followup local worker sequence. |
| `scripts/cms-e2e/diagnostics.mjs` | Static media phase/status/code registry and filtered timing/observation wire format. |
| `tests/e2e/safe-reporter.mjs` | Emit validated media timing and annotation observations. |
| `tests/e2e/cms-media.spec.ts` | Observe actual guarded upload phases and split first timeout's scope phases; assertions and POST forwarding remain. |
| `tests/cms-e2e-diagnostics.test.mjs` | Accept exact safe records; reject forged codes, fields, and case attribution. |
| `tests/browser-local/cms-media-upload-feedback.mjs` | Loopback Chromium probe of actual React feedback with synthetic action/POST. |
| This report | Evidence, limitations, and delta-review handoff. |

## Local validation

All local subprocesses used Node **22.23.2** through the existing filtered
`.next/cms006-local-20260926-05e7d1/run.cjs` wrapper: dummy DB/auth,
`.env` read guard, blocked DB ports, and no inherited staging credentials.
The Chromium probe used its own loopback HTTP server and synthetic data.

| Check | Result |
|---|---|
| Focused regression before fixture stage fix | **Expected FAIL:** 4 pending, expected 0. |
| Same focused regression after fix | **PASS:** 1/1; acknowledged receipts committed and pending zero. |
| Focused harness/diagnostics/storage | **PASS:** 39/39 before the final added ACK-loss/worker cases; final full run includes all current tests. |
| Real worker sequential probe | **PASS:** 1/1, PNG → JPEG → malformed → six PNG followups. |
| Real `MediaLibrary` loopback Chromium probe | **PASS:** `MEDIA_BUSY` retained File and no POST; synthetic successful POST showed success status; Chromium 153.0.8010.12, no page errors. |
| Full unit/action suite | **PASS: 843/843**, 0 fail/skip/cancel. |
| Lint / `tsc --noEmit --incremental false` | **PASS / PASS**. |
| Playwright discovery | **PASS: 122** (90 baseline + 32 MED); callbacks/browser staging **NOT RUN**. |
| `git diff --check` / new-file whitespace and conflict-marker scan | **PASS**: zero diff-check errors, zero trailing whitespace or conflict markers in both new files. |
| Production build / assembled smoke | **NOT RUN**: delta does not touch product bundle, worker implementation, storage runtime, or dependencies. Earlier CI PASS belongs to unpatched commit. |

Claude delta review should verify the fixture's acknowledged-commit boundary
and crash/unknown-ACK behavior, confirm the pending quota regression uses the
application function, review the safe diagnostic allowlists and result
provenance, and ensure the media spec's assertions and default timeouts remain
unchanged. The original staging run remains **FAIL**. This patch has **NOT RUN**
CI or staging; the initial `MED-08/11` timeout remains **UNDETERMINED** until
new phase evidence is obtained. CMS-009 is **NOT COMPLETE**. Manual authenticated
production UAT remains **DEFERRED** by the Product Owner.

Final local Git status: seven tracked content files modified and two new files,
all unstaged; the index is empty and HEAD unchanged. `next.config.ts` still
appears as the known status-only `M`: its Git-normalized blob equals HEAD and
its content diff is empty. It was not edited, restored, or staged. The QA
checkout remains at the same detached commit with clean status/index.
