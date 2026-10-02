# CMS-009 — local investigation of MED-08/11 and MED-14-COVER

Checkpoint: `feature/cms-009-media-library` at `a7f1776f65575e1ef173e42ec4526b01c7b1d157`. This is an **UNSTAGED** diagnostic delta for Claude review. No product component, route, worker, storage adapter, schema, dependency, timeout, retry, fixture policy or cleanup guard changed.

## Evidence and conclusion

The staging evidence was **operator-launched and Claude-monitored, supplied by the Product Owner**. The UTF-16LE QA log was read only. Run `e3a2c2dd12ee43c32e9f6135`, BUILD_ID `yLBX6m0qxdPOOlcmJwOGD`, finished **120 passed / 1 failed / 1 timedOut** of 122, exit 1 and no `CMS_E2E VERIFIED`. The 90 baseline cases, MED-23-COVER and MED-26 passed; all 19 cleanup counters were zero. This remains a failed staging run, not a local browser result.

| Case | Staging fact | Local reproduction / source finding | Conclusion |
| --- | --- | --- | --- |
| MED-08/11 | Creator POST 200 and DB_CHECK passed. Other login 2,374 ms, media navigation 719 ms and query input 54 ms passed. `MED_SCOPE_OTHER_SEARCH` started at test offset about 10,082 ms and failed after 49,974 ms at the 60-second case deadline. No search HTTP status was recorded. | Installed Playwright 1.63.0 performs visible/enabled/stable and hit-target checks, then waits for click-created navigation. Installed Next 16.2.6 posts Server Actions to the page's canonical URL. The real `MediaLibrary` component mounted in loopback Chromium with an initially empty list emitted click and submit, disabled the search button while the synthetic action was held, re-enabled after its response, and did not navigate. Click dispatched in 125 ms in the final probe. This probe lacks the authenticated Next route, real Server Action and full app CSS. | **UNDETERMINED.** A permanently broken button is contradicted in this local condition, but the staging wait can still be actionability, hydration/dispatch, Server Action, UI settling or navigation. |
| MED-14-COVER | Setup upload intent was reserved; POST was forwarded and returned HTTP **500/INTERNAL_ERROR** at upload elapsed 2,535 ms. UI retained `UNKNOWN_OUTCOME`; the success assertion failed at about 10,984 ms, before cover/autosave conflict steps. | Real POST route and `safeMediaResponse` under controlled synthetic fault injection yielded the same 500/INTERNAL_ERROR for actor-transaction, status-read, journal, codec and post-DB-ACK failures. DB transaction failure inside the route's guarded write instead yielded 500/UNKNOWN_OUTCOME; lock contention gave 409/MEDIA_BUSY and explicit storage failure 503/MEDIA_STORAGE_UNAVAILABLE. The post-ACK synthetic fault left a `file-ready` durable receipt with a row, and status GET reported COMMITTED. | **UNDETERMINED.** The staging response code excludes those distinct safe codes, but does not identify which unclassified exception occurred or whether its DB write committed. |

The route fault test uses the actual route and HTTP mapping with in-memory Prisma/storage/codec adapters. It does **not** recreate MariaDB, worker process, Windows filesystem permission, production storage or the staging exception. Existing recovery tests remain the evidence for real storage adapter rules. The current staging log has no exact failed-operation receipt or row snapshot; 19 zero cleanup counters describe the end of cleanup, not the earlier POST boundary.

## Diagnostic delta and preserved assertions

- `scripts/cms-e2e/media-search-observation.ts` and `tests/e2e/cms-media.spec.ts` observe the real MED-08/11 button before click, browser click/submit events, the exact `/creator/media` POST request/response/failure, document navigation, and disabled-to-enabled UI cycle. An empty initial list is no longer treated as search completion: the case requires click/submit, action request with successful HTTP response, and busy-to-idle UI before its existing foreign-hidden, GET 404 and admin-visible assertions. The click remains native Playwright `.click()` with no force, navigation opt-out, retry or sleep. Failure still propagates.
- `scripts/cms-e2e/media-upload-failure-state.ts` reads only the exact captured upload operation after an upload success assertion fails. It checks the receipt stage, exact scoped media row count, and exact object/temp-journal existence. The client still retains `UNKNOWN_OUTCOME` and never resends, declares commit or removes a receipt because of this probe.
- `scripts/cms-e2e/diagnostics.mjs` and `tests/e2e/safe-reporter.mjs` admit two new exact-schema record kinds: `MEDIA_SEARCH_SIGNAL` only for MED-08/11 and `MEDIA_UPLOAD_STATE` for an allowlisted MED case. They emit fixed codes, actor `other`/`admin`, elapsed milliseconds, numeric HTTP status and `present`/`absent`/`unknown` states. They reject extra fields. No URL, query, ID, filename, path, metadata, body, cookie, SQL or stack is serialized.
- `tests/cms-e2e-diagnostics.test.mjs` checks reporter/filter survival and payload rejection. `tests/cms-media-upload-failure-state.test.mjs` exercises the exact receipt/row/file snapshot and identity mismatch. `tests/cms-media-upload-route-faults.test.mjs` tests eight controlled route boundaries and committed status GET. `tests/browser-local/cms-media-search-click.mjs` exercises the real component's native click with controlled synthetic action. `tests/README.cms-e2e.md` explains how to read the new evidence.

All MED-23-COVER/MED-26 changes from the preceding patch, ownership/CAS, journal/recovery, quota, 19-counter cleanup, original MED-08/11 scope/GET/admin assertions and MED-14 cover/autosave assertions remain unchanged. No product fix is claimed without a reproduced root cause.

## Validation

All local subprocesses used **Node 22.23.2** through the existing filtered wrapper with dummy DB/auth variables, `.env` read guard and blocked DB ports; there was no real DB connection. Scratch outputs are under ignored `.next/`. Results after the final helper/import change:

| Check | Result |
| --- | --- |
| Real MediaLibrary loopback Chromium probe | **PASS**; initially empty library, click/submit, busy/idle cycle, no navigation, no page errors; Chromium 153.0.8010.12. Synthetic action, no Next Server Action or DB. |
| Focused diagnostics, snapshot and actual-route fault tests | **30/30 PASS**; eight route fault boundaries checked in one test. |
| Full unit/action suite | **848/848 PASS**, 0 failed/skipped. |
| ESLint | **PASS**. |
| TypeScript `--noEmit --incremental false` | **PASS**. |
| Playwright discovery with checked-in SafeReporter | **122 cases PASS**; discovery only, browser staging **NOT RUN** on this delta. |
| `git diff --check`, new-file whitespace/conflict scan | **PASS**; six new files scanned separately. |

No isolated build was required: product source, worker/storage/assembly and dependencies were untouched. The QA checkout, its artifacts and dependencies remained read only. `next.config.ts` retains its pre-existing status-only `M`, with empty diff and normalized blob equal to HEAD (`4d0d963d45e57b949a3add6a600832ce14efbce6`); it is outside this delta and remains unstaged. Git status at handoff: five modified content paths, six new untracked paths, plus that status-only `next.config.ts`; index empty.

Claude should review the signal classification against actual Next Server Action requests, the busy-to-idle completion gate, the exact failure snapshot's authority and the two allowlisted reporter records. CI and staging of this delta are **NOT RUN**. A later guarded full-122 staging run, only after review/CI, must provide new runId/BUILD_ID, both remaining cases and all regressions passing, and 19 zero cleanup counters with `CMS_E2E VERIFIED`. CMS-009 is **NOT COMPLETE**. Manual authenticated production UAT remains **DEFERRED**, and production private-storage provisioning/ACL/proxy/backup/persistence release gates remain open.
