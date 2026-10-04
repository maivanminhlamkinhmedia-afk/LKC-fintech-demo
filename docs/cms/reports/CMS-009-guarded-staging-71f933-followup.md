# CMS-009 — guarded staging `71f93380727d1dd1fe418ea8` local follow-up

## Checkpoint and evidence boundary

Local branch `feature/cms-009-media-library` remains at
`2b3fa4bc91578a7b785435a5add63d5132013a20` (parent
`877d2756723242cafaca482f2fb42b6ea606c55f`). The index was empty before
work. `next.config.ts` is a pre-existing status-only `M`: its diff is empty and
its Git-normalized blob equals HEAD (`4d0d963d45e57b949a3add6a600832ce14efbce6`).
It was not edited, staged or reset.

The Product Owner reports operator-launched, Claude-observed staging with
runId `71f93380727d1dd1fe418ea8`, BUILD_ID `zq4L65r7au_7qqdyzNm61` and
the checkpoint commit above. Read-only inspection found the exact v4 manifest
under `playwright/.cms-e2e/<runId>.json` and build metadata under
`.next/cms-e2e-build-<runId>/.next/cms-e2e-build.json` in the QA checkout;
the metadata records the same commit and BUILD_ID. The UTF-16LE log
`.next/cms009-staging-logs/run-20261003-085629-4e537f7f3de342729e01e6421b203339.log`
has 122 CASE records: **120 passed, 2 failed, 0 timed out**. Its two failed
cases are MED-08/11 and MED-16-MATRIX; RESULT is failed. The log contains no
literal runId/BUILD_ID, so its association is by the exact manifest/build
metadata, timestamp and unique case/result pattern, not a self-identifying log
header. PO reports exit 1, `BROWSER_SUITE_FAILED`, no VERIFIED marker and 19
cleanup counters equal to zero. This is **staging FAIL**, not a new Codex
staging run.

## MED-08/11 — request lifecycle, root cause UNDETERMINED

Staging's other actor produced click/submit, one recorded action request,
response HTTP 200 at 672 ms and button reenabled at 675 ms. Foreign-hidden
and protected GET 404 passed. Admin produced click/submit, action request at
71 ms, response HTTP 200 at 648 ms, `ACTION_FAILED` at 649 ms and button
reenabled at 652 ms. The existing assertion rejected the failure before
admin-visible ran. The old observer had no request ordinal, failure code or
`requestfinished`; it marked `actionSucceeded` at response headers. Therefore
the log cannot establish whether its HTTP 200 and failure belong to one
request or different POSTs, nor whether the action body completed. Button
reenabled is also a `finally` state in MediaLibrary, not proof of successful
search. No server, network or Next root cause is claimed.

Source inspection of installed Next 16.2.6 shows the client sends Server
Actions with `fetch` and decodes the Flight result from the response body.
Installed Playwright 1.63.0 distinguishes `response` (headers),
`requestfinished` (body complete) and `requestfailed` (transport failure).
An isolated local Next 16.2.6 + Chromium probe with a real Server Action,
synthetic result and filtered dummy environment observed one POST with a
Server Action header, `request → response 200 → requestfinished`, then rendered
the result (probe exit 0). This establishes the successful local sequence,
not the admin request sequence on staging. The probe lives only under ignored
`.next/cms009-next-action-probe`; it uses no CMS login or DB.

The test-only observer now assigns each classified request an internal ordinal
and records `ACTION_FINISHED` or `ACTION_FAILED` for that same ordinal. A failed
request exposes only a fixed failure code or `OTHER`; no raw browser error,
query, URL, action ID, headers or payload crosses the diagnostics filter.
`actionFinishedOk()` requires exactly one observed action POST, a 2xx response
and `requestfinished` for that request. The test continues to reject
`ACTION_FAILED` and navigation, checks `[data-error-code]`, foreign-hidden,
GET 404 and admin-visible, and retains native click, timeout and retry settings.
This is a completion/diagnostic correction; **MED-08/11 is not marked PASS**.
The next guarded staging log must show each ordinal's response/finish/failure
and the admin-visible result to resolve the remaining question.

## MED-16-MATRIX — rename EPERM confirmed, staging holder UNDETERMINED

Staging emitted one app-origin `APP_JOURNAL phase=rename errno=EPERM` marker.
MED-16-MATRIX separately recorded POST HTTP 500/`INTERNAL_ERROR` at 2546 ms,
UI `UNKNOWN_OUTCOME` at 10885 ms, and a later snapshot with receipt
`canonical-ready`, DB row absent, object present and temp journal present.
The marker has no case/operation ID; temporal proximity cannot attribute it
conclusively to MED-16. The snapshot consists of reads after the failure,
not one atomic state. Other historical HTTP 500s are not assigned this cause.

Source inspection found that the route advances the journal after canonical
file publication and before the DB transaction. `advanceMediaOperation`
fsyncs a same-filesystem temp receipt and atomically renames it over the old
receipt; failure retains the temp for recovery. A **real Windows filesystem**
local probe with the actual storage module, synthetic operations and no DB
reproduced four of four `rename` EPERM results while an old receipt read handle
remained open; the primary receipt stayed `intent` and the temp remained. A
concurrent read-polling probe produced two EPERM and two successful renames;
four idle operations succeeded. These show a concrete local mechanism but do
not identify which process, if any, held the staging receipt. A separate
synthetic fault injection retains coverage for open/write/sync/close/rename.

The product change retries **only EPERM from the same atomic rename**, after
50 and 150 ms, while the existing caller lock is held. It does not repeat
file publication, DB mutation or request handling, and never unlinks the
destination. The committed browser-local probe calls the real Windows rename:
when its held read handle is released after the first real EPERM, the next
attempt succeeds with no temp and an advanced receipt; when the handle stays
open, three real EPERM attempts propagate once with the old receipt and temp
preserved. Non-EPERM faults still propagate immediately. The route continues
to return unknown outcome on terminal errors; receipt/ownership/recovery
guards remain in place. The 200 ms maximum added wait is a bounded local
mitigation, not proof that MED-16 will pass staging or that its precise file
holder is known.

## Changed content paths

- `src/features/cms/media-storage.ts`: bounded same-rename EPERM retry.
- `scripts/cms-e2e/media-search-observation.ts`: request ordinal, finished and
  allowlisted failure signals, correlated completion.
- `scripts/cms-e2e/diagnostics.mjs`: strict schema/filter for those signals.
- `tests/e2e/cms-media.spec.ts`: require correlated action completion; keep
  failure, UI, scope and GET assertions.
- `tests/cms-media-search-observation.test.mjs`: success, truncated 200,
  500, duplicate POST and failure-code regressions.
- `tests/cms-e2e-diagnostics.test.mjs`: safe reporter/filter schema and
  rejection cases.
- `tests/browser-local/cms-media-journal-windows.mjs`: real held-handle
  transient/persistent probes with retained fault-injection matrix.
- `tests/README.cms-e2e.md` and
  `docs/cms/operations/cms009-media-storage.md`: signal and recovery limits.
- This report.

## Local validation and remaining gates

All local subprocesses used prepared Node **v22.23.2**, filtered dummy env,
an `.env` read guard and blocked DB ports. No real DB, staging or QA checkout
mutation was performed.

| Check | Actual result |
| --- | --- |
| Focused diagnostics + observer tests | **30/30 PASS** |
| Full unit/action suite | **856/856 PASS**, 0 fail/skip/cancelled |
| Real Windows storage probe | **10/10 PASS**; held-transient and held-persistent outcomes above |
| Browser-local search click / hit-test probes | **PASS**; these use synthetic actions and do not establish staging Server Action behavior |
| Isolated real Next/Server Action + Chromium probe | **PASS**, exit 0; one request/response 200/finished and rendered result |
| ESLint / TypeScript | **PASS / PASS** |
| Playwright discovery | **122 cases PASS**; browser execution **NOT RUN** locally |
| Isolated production build + media assembly | **PASS** via direct Next CLI and assembler in fresh snapshot; 182 allowlisted inputs, 0 source/snapshot hash mismatches |
| Assembled standalone media worker smoke | **PASS**; 1×1 PNG canonicalized to 70 bytes |
| `git diff --check` and new-file whitespace/conflict scan | **PASS** |

The filtered wrapper's `npm run lint`, `npm run test:e2e:list` and initial
`npm run build` launcher returned exit 1 after printing only the script banner;
direct calls to the same installed ESLint, Playwright, Next and assembler
passed under the same filtered env. The initial standalone smoke assumed a
flat output path, then passed after its ignored scratch locator used the
runtime `server.js` directory. These local harness attempts are not
presented as application failures or as staging results.

Claude delta review, CI and guarded staging of this diff are **NOT RUN**.
The next review should scrutinize the single-request completion gate, safe
diagnostic schema, and atomic retry/failure semantics. The new staging run
must retain all 122 cases, full 19-counter cleanup and VERIFIED gate; MED-08/11
must reach admin-visible, and MED-16 must complete upload/DB checks. The LOW
keyboard coverage remains open. Manual authenticated production UAT remains
**DEFERRED** by PO; production storage provisioning/ACL/proxy/backup/persistence
release gates remain open. CMS-009 is **NOT COMPLETE**.

All implementation/test/docs changes remain **UNSTAGED**; the index is empty.
Final Git status is eight modified content paths and two new untracked content
paths listed above, plus the separate pre-existing status-only `M` for
`next.config.ts`. That file's normalized blob still matches HEAD.
