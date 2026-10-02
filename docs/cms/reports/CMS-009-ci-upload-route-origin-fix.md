# CMS-009 CI upload-route origin test fix — local handoff

## Cause and scope

The CI failure is **CONFIRMED** as an environment-dependent test setup. CI run `36961634408` tested head `1c893dea40df53a10224496cf35d6066e32cff2a` and reported 847/848 unit/action tests passing. The new upload-route fault test stopped at its first (`read`) case: expected HTTP 500, received 403. The real route calls `requireUploadOrigin` before the injected read failure; that guard requires `NEXTAUTH_URL` to match the request's `Origin`. The request uses `http://127.0.0.1:3001`, but `.github/workflows/ci.yml` does not set `NEXTAUTH_URL`. The earlier local validation wrapper did set it to `:3001`, hiding the dependency.

The only product test change is in `tests/cms-media-upload-route-faults.test.mjs`. It now sets the dummy `NEXTAUTH_URL` to the request origin around the nine existing fault cases and restores the exact inherited state in `finally` (including deleting an originally absent key). The test is explicitly non-concurrent. A focused regression checks restoration after both normal completion and a thrown assertion, starting from absent and inherited configurations. The route, real Origin guard, fault injection, expected status/error codes, receipt/row/object checks and GET `COMMITTED` assertion are unchanged. No source, workflow, timeout, retry or staging guard was changed.

## Reproduction matrix

Each row is a separate Node v22.23.2 subprocess with an allowlisted environment, dummy `DATABASE_URL`, blocked DB ports and `.env` read guard. Scratch logs/probe are ignored under `.next/cms009-ci-origin-local/`; no database was queried.

| Initial `NEXTAUTH_URL` | Before fix | After fix |
| --- | --- | --- |
| Absent | FAIL: first `read` case 403 !== 500 | PASS 2/2 |
| `http://127.0.0.1:3000` | FAIL: first `read` case 403 !== 500 | PASS 2/2 |
| `http://127.0.0.1:3001` | PASS 1/1 | PASS 2/2 |

The first test's loop has nine fault rows and asserts the expected response, durable stage, DB row and file state for each. Its after-DB-ACK branch also asserts the subsequent GET returns `COMMITTED`. Final checks require nine completed rows and the GET receipt check, so a PASS cannot stop at the first fault row. The second test verifies restoration for success and thrown-error paths; it also restores its own inherited environment in `finally`.

## Validation and limits

Node v22.23.2, existing dependencies, filtered dummy subprocess environment:

| Check | Result |
| --- | --- |
| Three focused before/after subprocesses | Results above |
| Full unit/action suite (direct Node `--test` on all 62 `tests/*.test.mjs` files) | **849/849 PASS**, 0 fail/skip/cancelled |
| ESLint via direct Node CLI | **PASS** |
| TypeScript `--noEmit --incremental false` | **PASS** |
| Playwright discovery | **122 cases**, PASS; browser not run |
| `git diff --check` and new-file conflict/whitespace scan | **PASS** |

The existing filtered wrapper's `npm run test:unit` and `npm run lint` invocations exited immediately after printing their npm headers in this Windows shell. They are **not** counted as passing gates. The same wrapper then ran the Node test runner and ESLint entrypoints directly with the filtered environment; those checks passed. No package/Node installation, Prisma, build, CI rerun, staging, SSH, real DB, fixture or cleanup operation was performed. CI must still run all gates on a later reviewed commit.

This test fix does not resolve MED-08/11 or MED-14-COVER on staging; their causes remain **UNDETERMINED**. The historical CI FAIL and guarded staging FAIL remain recorded. CMS-009 is **NOT COMPLETE**. Manual authenticated production UAT remains **DEFERRED**, and production storage provisioning/ACL/proxy/backup/persistence gates remain open. The previous two LOW review notes are outside this delta.

## Handoff

Expected unstaged content delta: this report and `tests/cms-media-upload-route-faults.test.mjs`, for Claude delta review. HEAD remains `1c893dea40df53a10224496cf35d6066e32cff2a`; index remains empty. `next.config.ts` has pre-existing status-only `M`: its diff is empty and Git-normalized blob matches HEAD; it was not edited or staged. Final Git verification is recorded in the handoff message.
