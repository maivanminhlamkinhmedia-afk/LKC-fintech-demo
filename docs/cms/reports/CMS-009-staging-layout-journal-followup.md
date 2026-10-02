# CMS-009 staging layout and journal follow-up — local handoff

## Staging evidence and scope

The Product Owner supplied an operator-launched, Claude-monitored run on commit `877d2756723242cafaca482f2fb42b6ea606c55f`: runId `b26503ba9d5b518891a1c933`, BUILD_ID `0v801fNZKwy2XfMAbLGtz`. I decoded the named log as UTF-16LE and parsed its structured records read-only. It contains 122 `CASE` records: **120 passed / 1 failed / 1 timedOut**; `RESULT` is failed and there is no `CMS_E2E VERIFIED`. The Product Owner reports exit 1 and all 19 cleanup counters zero. MED-08/11 timed out; MED-21 failed. MED-14-COVER, MED-14-AUTOSAVE, MED-23-COVER and MED-26 have `passed` case records, as do the 90 baseline cases. This is supplied staging evidence, not a run performed locally.

MED-08/11 completed other-actor login, `/creator/media` navigation and query fill. Its only `MEDIA_SEARCH_SIGNAL` was `BUTTON_COVERED`, recorded 30 ms after observer creation. `MED_SCOPE_OTHER_SEARCH` started at case-relative 10,571 ms and failed after 49,478 ms at 60,050 ms; there was no click/submit/action signal. A single pre-click hit-test does **not** prove continuous obstruction for the entire click. The former signal also grouped a null hit and an out-of-viewport center with a genuine overlapping element. The earlier 20/20 immediate-response probe mounted only `MediaLibrary`, omitting the portal, floating widget and app CSS; it did not exclude a layout obstruction.

MED-21's setup upload received POST HTTP 500/`INTERNAL_ERROR` after intent reservation and forwarding. The UI showed `UNKNOWN_OUTCOME`; the read-only failure snapshot was `journalStage=intent`, `rowPresent=absent`, `objectPresent=absent`, `tempJournalPresent=present`. This does not establish a metadata single-flight failure or the exact filesystem operation that failed. Older MED-14-COVER HTTP 500 runs must not be assigned the same cause; that case passed here.

## MED-08/11: locally confirmed layout failure and fix

`tests/browser-local/cms-media-search-layout.mjs` mounts the **real** `MediaLibrary`, `PortalShell` and `FloatingContact` with CSS freshly compiled from `src/app/globals.css`. Only authentication/navigation adapters and the Server Action are synthetic; an empty other-actor library is supplied. Chromium is loopback-only and external requests are blocked. A separate local Playwright fixture probe measured that `browser.newContext({ baseURL })` under the repository's Desktop Chrome project inherits **1280×800**; a standalone default context is **1280×720**. The probe uses the project viewport and a controlled 32 px scroll to place a visible search row under the floating widget. This scroll is an explicit local condition, not a claim about the exact staging scroll offset.

Before the product change, the search button's center was inside the viewport and `elementFromPoint` hit the transparent `FloatingContact` parent (`x=1027..1256`, `y=444..776`), not the button (`x=1139..1240`, `y=670..712`). Native Playwright click failed; changing only the widget parent's pointer events in the probe made the same native click dispatch and update the empty result. At standalone 1280×720, native click passed: the browser auto-scrolled the button below the parent. That difference is why the previous narrower probe could pass.

The product fix makes the fixed parent `pointer-events-none` and keeps the toggle `pointer-events-auto`; open child contacts already set their own pointer events. With the same 1280×800 probe, the button itself received the center hit and native click passed. The toggle opened and closed, the Facebook link was hit-testable, and the Zalo button and expanded group link remained interactive. No force click, synthetic click event, E2E locator/assertion change or timeout increase was used. This confirms a **local product hit-test bug** matching the staging pre-click signal; a post-fix guarded staging run is still required to verify MED-08/11 there.

The diagnostic helper now distinguishes `BUTTON_OUTSIDE_VIEWPORT`, `BUTTON_NO_HIT` and genuine `BUTTON_COVERED`. A separate Chromium classifier probe passed all four states, including `BUTTON_READY`; the safe registry test accepts only the fixed new codes. This diagnostic correction alone is not claimed as a timeout fix.

## MED-21: real filesystem boundary, staging cause undetermined

`tests/browser-local/cms-media-journal-windows.mjs` uses the real `media-storage.ts`, private local roots admitted by its guard, and actual Windows files. Its file-system proxy injects one **synthetic** errno at a named boundary while all other I/O remains real. Normal journal advance moved `intent` to `dispatched` with no temp file. Open failure left no temp. Write, sync, close and rename faults each left `intent` plus a temp file; an already-existing temp journal did too. A held operation lock made a second concurrent operation return `MEDIA_BUSY` while the first completed and left no temp. These are possible mechanisms, **not** a reproduction of the staging exception or its errno.

`advanceMediaOperation` now logs only `CMS_MEDIA_JOURNAL_ADVANCE_FAILED phase=<open|write|sync|close|rename> errno=<allowlisted|OTHER>` on failure. The local fault probe asserts the exact fixed message for each boundary and no message for successful advance. There is no path, operation ID, metadata, raw message or stack. The exception is rethrown; `wx`, write, fsync, close, atomic rename, lock, public HTTP/error contract and recovery behavior are unchanged. The staging cause remains **UNDETERMINED** until a guarded run captures the relevant phase/errno (or other direct evidence). The old snapshot alone cannot distinguish write/sync/close/rename from an existing temp file.

**Transport correction after Claude review:** The statement above proves only that the app emits the marker. At this report's original checkpoint, `run.mjs` resumed and discarded app stderr; the marker could not reach the guarded operator log. The separate transport delta in `CMS-009-journal-output-transport.md` adds and locally verifies a narrow forwarding path. No staging log has yet shown the new forwarded record.

## Changes and validation

Content delta for Claude review:

- `src/features/landing/components/FloatingContact.tsx` — pointer-event boundary.
- `scripts/cms-e2e/media-search-observation.ts`, `tests/cms-e2e-diagnostics.test.mjs` — fixed hit-test classification and safe registry test.
- `src/features/cms/media-storage.ts` — bounded journal phase/errno diagnostic without changing write/error semantics.
- `tests/browser-local/cms-media-search-layout.mjs`, `tests/browser-local/cms-media-search-signals.mjs`, `tests/browser-local/cms-media-journal-windows.mjs` — real-component/browser and real-filesystem regressions with explicit synthetic boundaries.
- `tests/README.cms-e2e.md` — interpretation of the new safe signals.
- This report.

All local subprocesses used prepared Node **v22.23.2**, existing dependencies, the filtered dummy environment, `.env` read guard and blocked DB ports. No real DB, staging, SSH or QA checkout mutation occurred.

| Check | Actual result |
| --- | --- |
| Focused media storage, diagnostics, route, failure-state and harness unit tests | **45/45 PASS** |
| Full unit/action suite, direct Node test runner | **849/849 PASS**, 0 fail/skip/cancelled |
| ESLint / TypeScript `--noEmit --incremental false` | **PASS / PASS** |
| Playwright discovery | **122 cases**, PASS; browser staging **NOT RUN** |
| Full-component Chromium layout probe | Before fix 1280×800 native click **FAIL**, controlled parent-only bypass **PASS**; after fix native click and widget controls **PASS** |
| Browser hit-test classifier probe | **4/4 PASS**: ready, outside, null, actual overlay |
| Real Windows journal boundary probe | **8/8 PASS** including normal, five injected call failures, existing temp and locked concurrent attempt |
| Fresh isolated production build | **PASS**: 182 allowlisted inputs, no source/snapshot hash mismatch; Next build and standalone media assembly PASS |
| Standalone media codec smoke on that build | **PASS**: 1×1 PNG canonicalized, 70 bytes |
| `git diff --check`, new-file whitespace/conflict scan | **PASS** |

Probe history is retained in ignored local logs. The first layout probe failed on a probe-specific Zalo assertion: hover opened the submenu and the following click correctly closed it; the probe was corrected to check both transitions. A 1280×720 run passed, and a scrolled 1280×720 run initially hit the parent but Playwright scrolled the button clear before dispatch. The exact 1280×800 project-viewport run failed before the product fix and passed after it. A first concurrent journal probe missed `rmdir` in its test-only filesystem proxy, causing a synthetic lock-release assertion; adding the proxy export made the eight-case probe pass. The first two copied standalone smoke attempts assumed the old flat bundle path and failed in the scratch harness; the final smoke located this build's nested runtime bundle and passed. None of these failed probes was treated as a product or staging PASS.

Remaining limits: no post-fix staging/MariaDB run, no confirmed MED-21 staging errno, and no authenticated production UAT. CMS-009 is **NOT COMPLETE**. Manual authenticated production UAT remains **DEFERRED**; production storage provisioning/ACL/proxy/backup/persistence release gates remain open. Keep the delta **UNSTAGED** for Claude independent review; no commit/push/CI rerun/merge/deploy.
