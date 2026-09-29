# CMS-008 TAX-08 bounded test budget — local handoff

## Product Owner-supplied staging evidence

Task `be7vh22pk`, runId `f93baded1e3d443c22aa9715`, BUILD_ID
`286HjBamKj2fPMlk4_ZWw`, tested commit
`0bad17db2cc2746679fa6f335e83a5a592260c99`: **89 passed / 0 failed /
1 timedOut / 0 skipped**. Only TAX-08 timed out. Exit 1,
`BROWSER_SUITE_FAILED`, no `CMS_E2E VERIFIED`. All 13 cleanup counters were
zero; clean cleanup does not convert the failed suite into a verified run.

TAX-10/11 passed its entire round trip with an 82,893 ms body span: REPLACE,
CLEAR, DB/reload and preserved-field assertions all executed and passed. Its
120-second override is retained unchanged.

For TAX-08, `TAX_GRAPH_RECOVER` began at testOffset 58,673 ms. After Hooks
started around 60,024 ms while body recovery continued to settle after the
deadline. The body entered `TAX_GRAPH_SNAPSHOT` around 60,035 ms, after
teardown had begun; that snapshot failed and the body ended around 61,358 ms.
Official teardown, recovery and disconnect passed. This supports a
**whole-test 60-second budget interruption**, but neither the cause of the
post-deadline snapshot failure nor the source of operation latency is known.
The recorded offsets and spans are not an exact active-slot counter or
remaining-budget measurement.

## Minimal patch and lifecycle effect

Only TAX-08 gains `test.setTimeout(120_000)` as the first statement of its
callback, before any asynchronous operation or `TAX_DELETE_GUARDS`. A short
comment names the four-kind delete/cancel/used guards and full-graph work
seen at the deadline. TAX-10/11 keeps its reviewed 120-second override. The
default 60 seconds applies to the other 88 cases; `expect.timeout` stays at
10 seconds, with one worker, zero retries and 90 discovered cases. Assertions,
action order, recover/snapshot count, journal writes, ownership, identity,
provenance and cleanup guards stay unchanged. No product source, schema,
dependency, reporter/filter/TIMING, or lifecycle code changed.

In installed Playwright 1.63.0, `test.setTimeout` updates the current test's
timeout slot. The After Hooks slot uses
`calculateMaxTimeout(project.timeout, testInfo.timeout)`, so TAX-08 also gets
a **fresh shared 120-second slot** for `afterEach` and ordinary test-fixture
teardown. No lifecycle behavior was altered to mask failures. The 120-second
bound is proposed for this case; it is not a measured completion time or a
production performance standard, and it does not guarantee a PASS.

`SafeReporter` reads reporter-side `test.timeout` during steps. Playwright
updates that metadata at `onTestEnd`, so step `TIMING.testTimeoutMs` can still
show `60000` while the effective case bound is `120000`. Do not use that field
as a staging gate or as evidence of a broken override. `bodyElapsedMs` and
`durationMs` aid interpretation but do not reveal exact active-slot use.

## Validation and handoff

Prepared Node **22.23.2**; local subprocesses used the existing sanitized
wrapper with dummy DB/auth settings and `.env`/DB access guards. No browser
staging, real DB, staging fixtures or cleanup were run.

| Check | Result |
| --- | --- |
| Focused taxonomy timing, recovery and diagnostics tests | **33/33 PASS** |
| ESLint for `tests/e2e/cms-taxonomy.spec.ts` | PASS |
| TypeScript `--noEmit --incremental false` | PASS |
| Playwright discovery | **90 cases**, PASS; callbacks not executed |
| `git diff --check` and new-file whitespace/conflict scan | PASS |
| Metadata probe, full unit suite, Prisma, production build | NOT RUN; no relevant source/schema/build change |
| Claude delta review, CI, staging for this patch | NOT RUN |

Commands used from the repository root with the prepared Node 22 executable
and `.next/cms006-local-20260926-05e7d1/run.cjs` sanitized wrapper:

```text
cms008-tax08-focused --test tests/cms-taxonomy-timing.test.mjs tests/cms-taxonomy-recovery-cost.test.mjs tests/cms-e2e-diagnostics.test.mjs
cms008-tax08-lint node_modules/eslint/bin/eslint.js tests/e2e/cms-taxonomy.spec.ts
cms008-tax08-tsc node_modules/typescript/bin/tsc --noEmit --incremental false
cms008-tax08-discovery npm run test:e2e:list
```

Discovery confirms inventory only and does not execute TAX-08's callback.
The next separately authorized guarded staging run must pass all 90 cases,
finish with exit 0, verify all 13 cleanup counters at zero and emit
`CMS_E2E VERIFIED`. TAX-08 has **not** been shown to complete under the new
budget. This three-file patch stays unstaged for Claude delta review, followed
by commit/push/CI and fresh staging. CMS-008 is not complete; manual
authenticated UAT remains DEFERRED.
