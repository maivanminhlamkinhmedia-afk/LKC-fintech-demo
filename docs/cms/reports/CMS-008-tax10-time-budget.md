# CMS-008 TAX-10/11 bounded test budget — local handoff

## Staging evidence supplied by the Product Owner

Task `bsnx32lfx`, runId `00667a4636f22ed81b5e4dc3`, BUILD_ID
`VDPQDbjs71nULJnT6rqry`, on commit `ae5a7bd601a5ef61dc86e25ee2a46b29f82dbaa1`:
89 passed / 0 failed / 1 timedOut / 0 skipped. Only TAX-10/11 timed out.
Exit 1, `BROWSER_SUITE_FAILED`, no `CMS_E2E VERIFIED`; all 13 cleanup counters
were zero. TAX-08 passed with a 55,239 ms body span; this is one observation,
not a stable duration or explanation of its earlier timeout.

For TAX-10/11, reported phase durations were SETUP 22,703 ms, INITIAL_SAVE
7,615 ms, NOOP 7,045 ms, PRIMARY_SWITCH 9,901 ms, and PRIMARY_CLEAR
9,469 ms. REPLACE began at testOffset about 56,754 ms;
`REPLACE_CATEGORY` passed after 2,705 ms. `REPLACE_TOPIC` began at offset
59,717 ms and ran only 324 ms before failing. After Hooks began around
60,024 ms; body span ended around 60,025 ms. Teardown, recovery and disconnect
completed cleanly. SETUP includes more than the five selection assertions;
multiple `choose()` calls are not retries of one assertion. Offsets and body
elapsed do not expose exact remaining test-slot time.

These timings support a **CONFIRMED whole-test budget interruption** at the
60-second limit. They do not identify which search, save or DB operation caused
latency, and they do not prove the unexecuted phases will pass with more time.

## Patch and lifecycle effect

Only `tests/e2e/cms-taxonomy.spec.ts` gains `test.setTimeout(120_000)` as the
first statement in the TAX-10/11 callback, before any asynchronous operation
or `TAX_SELECTION_ROUNDTRIP`. The comment states why this case needs a bounded
exception. `tests/README.cms-e2e.md` documents the exception. No product source,
assertion, action order, timing phase, reporter/filter, guard, schema,
dependency or configuration changed. Default test timeout remains 60,000 ms,
`expect.timeout` 10,000 ms, one worker and zero retries. All 89 other cases,
including TAX-08, retain their prior budgets. The 120-second value is a
proposed bound, not a measured completion time or a performance finding.

The installed Playwright 1.63.0 public `test.setTimeout` API changes the current
test timeout. In `lib/worker/workerProcessEntry.js`, the default slot is updated
by `TimeoutManager.setTimeout`; the subsequent After Hooks slot is allocated
using `calculateMaxTimeout(project.timeout, testInfo.timeout)`. For this case,
that yields a separate 120-second shared slot for `afterEach` and ordinary
test-fixture teardown, not only a longer body slot. This patch does not change
lifecycle handling. `beforeAll`, `afterAll` and custom-timeout fixtures may
have other slots as documented in the installed runtime.

Documentation correction after the Product Owner supplied Claude's delta review:
the review covered all three files and passed without a blocking finding. Its
metadata probe confirmed the effective 120-second test and fresh
afterEach/ordinary fixture-teardown slots. `SafeReporter` reads reporter-side
`test.timeout` while steps are reported; Playwright 1.63.0 updates that metadata
at `onTestEnd`. Consequently `TIMING.testTimeoutMs` in step records may remain
`60000` even though the TAX-10/11 override is effective. This correction was
added after Claude's review; the added prose itself was not part of that review.
No reporter or product code was changed.

## Verification and remaining gate

Local validation results are recorded in the implementation handoff below.
Playwright discovery does not execute test callbacks, so its count alone cannot
prove the runtime override. The next separately authorized staging run must
execute all 90 cases with exit 0, verify all 13 cleanup counters are zero and
emit `CMS_E2E VERIFIED`. `TIMING.testTimeoutMs: 120000` is **not** a staging
gate; a step record showing `60000` alone is not evidence that the override
failed. `bodyElapsedMs` and `durationMs` aid interpretation but are not exact
active-slot consumption or remaining budget. This patch has **not run on
staging**; it is not a claim that product latency is acceptable or that CMS-008
is complete. Manual authenticated UAT remains DEFERRED.

## Local implementation handoff

Prepared Node **22.23.2**; local subprocesses used the existing sanitized
wrapper with dummy DB/auth settings and blocked `.env`/DB access. No real DB,
browser staging, staging fixtures or cleanup were run.

| Check | Result |
| --- | --- |
| Focused taxonomy timing, recovery and diagnostics tests | **33/33 PASS** |
| ESLint for `tests/e2e/cms-taxonomy.spec.ts` | PASS |
| TypeScript `--noEmit --incremental false` | PASS |
| Playwright discovery | **90 cases**, PASS; callback not executed |
| `git diff --check` and new-file whitespace/conflict scan | PASS |
| Full unit suite, Prisma, production build | NOT RUN; no product/schema/build change |
| Claude delta review | **PASS**, Product Owner-supplied; 3/3 files, no blocking finding, metadata probe PASS. Added prose correction post-review. |
| CI, staging | NOT RUN |

Commands used from the repository root with the prepared Node 22 executable
and `.next/cms006-local-20260926-05e7d1/run.cjs` sanitized wrapper:

```text
cms008-tax10-focused --test tests/cms-taxonomy-timing.test.mjs tests/cms-taxonomy-recovery-cost.test.mjs tests/cms-e2e-diagnostics.test.mjs
cms008-tax10-lint node_modules/eslint/bin/eslint.js tests/e2e/cms-taxonomy.spec.ts
cms008-tax10-tsc node_modules/typescript/bin/tsc --noEmit --incremental false
cms008-tax10-discovery npm run test:e2e:list
```

Review should check that only the one case gains the bound, its placement
precedes the first asynchronous step, and the independent After Hooks slot is
recorded accurately. The patch stays unstaged for Claude delta review.
