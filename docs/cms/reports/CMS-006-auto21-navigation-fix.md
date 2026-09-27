# CMS-006 — AUTO-21 native navigation cancellation fix

Date: 2026-09-26. **ROOT CAUSE: CONFIRMED locally in test control flow.**
The cancelled native reload leaves Playwright's `page.reload()` navigation waiter
pending; the blanket catch consumes its eventual timeout. No evidence establishes
that the input was lost. This patch is **UNSTAGED**, awaiting Claude independent
review. Its CI/staging have **NOT RUN**. CMS-006 is **NOT COMPLETE** and CMS-005
authenticated production smoke remains **DEFERRED**.

## Checkpoint and supplied staging evidence

- Workspace: `D:\lkc_phase1_rbac_patch\LKC-fintech-demo`.
- Branch: `feature/cms-006-autosave`.
- HEAD before and after: `d9e08e7d81e90666c5e3d5b7edfc14c8baf0ca69`.
- Preflight matched branch/HEAD; tracked/untracked working tree and index were
  clean. No pre-existing changes were overwritten. PR #21 remains the existing
  draft; its earlier CI PASS does not validate this uncommitted patch.
- Read AGENTS.md, CMS-006 spec/handoff, staging runbook, actual AUTO-21/support/
  config/form/controller code, installed Next error/router guidance and installed
  Playwright types/implementation. No application changes were needed.

The following is **staging evidence supplied by Product Owner**, not a staging
run performed during this investigation:

| Item | Supplied result |
|---|---|
| runId | `0bb773444deaaf3683802ac3` |
| BUILD_ID | `a_MCzULF2aCqvzAl3VXXs` |
| Source commit | `d9e08e7d81e90666c5e3d5b7edfc14c8baf0ca69` |
| Browser outcome | 35 passed / 1 timedOut / 0 skipped; all 20 EDIT and 15 other AUTO cases PASS |
| Failure | AUTO-21 / AUTO_NAVIGATION, `tests/e2e/cms-autosave.spec.ts`, test line 359 |
| Operation | Lines 363–367 register/dismiss native beforeunload and await `page.reload().catch(() => {})` |
| Reported assertion | Line 368, column 31: retained-title assertion |
| Timeouts | Test 60,000 ms; expect 10,000 ms |
| Cleanup | Articles/profiles/users/logs = 0/0/0/0; runner/app stopped, lock released, Git clean |

Cleanup/guard success is separate from the correctness of the browser test.
The reported assertion location alone does not establish input loss.

## Local reproduction before changing the test

Used the already installed **Node v22.23.2 / Playwright 1.63.0 / Chromium
153.0.8010.12**, headless. A Node HTTP server binds only `127.0.0.1` on a random
port and serves synthetic HTML with one input, an actual native beforeunload
handler and a synthetic 2,000 ms debounce counter. A real input click provides
browser user activation. No Next/CMS server, login, account, DB, fixture, staging
runner, storage state, trace or screenshot is involved. Browser-context requests
outside that exact loopback origin are aborted.

Timing comes from **Node `performance.now()`**, independent of Playwright's
browser clock. Two triggers were compared with clock running and paused:

1. `page.reload({ timeout: 2000 })`, retaining the native dialog/dismissal and
   waiting for the actual operation to settle.
2. `page.evaluate(() => window.location.reload())`, also waiting for both the
   actual trigger promise and the verified native dialog dismissal.

The initial probe, before editing AUTO-21, observed:

| Trigger / clock | Dialog | Dismissed | Trigger settled | State after dismissal |
|---|---:|---:|---|---|
| Playwright reload / paused | 10 ms | 13 ms | TimeoutError at 2,020 ms | Page open; original input intact; trigger still pending |
| Playwright reload / running | 5 ms | 7 ms | TimeoutError at 2,006 ms | Page open; original input intact; trigger still pending |
| Native evaluate reload / paused | 4 ms | 15 ms | Fulfilled at 17 ms | Page open; input intact |
| Native evaluate reload / running | 5 ms | 7 ms | Fulfilled at 9 ms | Page open; input intact |

The same pending behavior without paused clock rules out fake-clock suspension
as a necessary cause in this reproduction. It does not claim every browser or
every navigation method has identical behavior.

### Reproducing the misleading assertion location with the actual timeout budget

A separate temporary Playwright test used only the synthetic loopback page,
the original reload/catch sequence, **60,000 ms test timeout**, **10,000 ms
expect timeout** and zero retries. Its config lives under the ignored local
probe directory, has no CMS global setup and does not load the CMS test suite.
Instrumentation records only Node timings, dialog type, promise state, retained
input/open-page booleans and error-location coordinates.

| Before-fix operation | Node elapsed from test body |
|---|---:|
| Enter original sequence | 184 ms |
| Native beforeunload appears | 203 ms |
| `dialog.dismiss()` completes | 207 ms |
| Page open/input retained verified; reload still pending | 215 ms |
| Test-budget timeout reaches reload; catch swallows error | 59,897 ms |
| Original Promise.all returns | 59,898 ms |
| Following retained-input expect is reported failed | Local repro line 34:40, duration 24 ms |
| Case result | **timedOut**, duration 60,058 ms; process exit 1 (expected reproduction failure) |

The later expect does not receive a fresh 10-second budget after the enclosing
test has timed out. This reproduces the supplied staging symptom: the next
assertion is a reported failure location even though the draft was already
verified intact after cancellation. The loopback timing is direct local
evidence; the staging operation timings were not captured and are not invented.

## Installed Playwright mechanism

The installed `node_modules/playwright-core/lib/coreBundle.js` explains the
observed behavior:

- Around line 22523, server-side `reload` awaits both delegate reload and
  `mainFrame().waitForNavigation(..., true, options)`, requiring a new document.
- Around line 37905, dismissing a main-frame beforeunload calls
  `frameAbortedNavigation` before acknowledging the dialog to Chromium.
- Around lines 23271–23274, `frameAbortedNavigation` returns without emitting an
  abort event when no pending document exists. The source shows pending-document
  bookkeeping depends on navigation/document-request signals.
- `waitUntil: 'commit'` still waits for the initial new-document navigation
  event; it only changes which later load milestone is awaited. It does not
  resolve the cancelled-navigation wait demonstrated here.
- `evaluate` executes the native reload without wrapping it in a Playwright
  new-document navigation waiter.

The internal missing-pending-document path is a source-level explanation
consistent with the observed cancellation/waiter behavior; this probe did not
instrument Playwright's private frame state. The confirmed defect is the test's
assumption that `page.reload()` promptly rejects on native cancellation, combined
with its catch swallowing the actual timeout. No application-loss hypothesis is
needed to explain the reproduced failure.

## Minimal fix and preserved AUTO-21 requirements

Only AUTO-21's reload trigger and its explanatory comment change:

```diff
- await Promise.all([page.reload().catch(() => {}), unload])
+ await Promise.all([page.evaluate(() => window.location.reload()), unload])
```

The dialog waiter is still registered first; `dialog.type()` must equal
`beforeunload` and the real native dialog must be dismissed. Promise.all awaits
both operations. There is no blanket error catch, abandoned navigation promise,
Promise.race, fake event, timeout increase, retry, skip or disabled unload guard.

All assertions after the trigger remain unchanged:

- Same title after cancelling native navigation.
- Cancel app-link navigation while dirty; advance existing debounce; one real
  Server Action request and saved state.
- Hold the actual action response, type a newer draft, then cancel app-link
  navigation while saving and verify the newer title remains.
- Accept app-link navigation, release the real response, reach the article list,
  and verify no follow-up for the unsent draft: request count two and the DB row
  still contains the sent snapshot.

No change to `ArticleDraftForm`, autosave controller, Server Actions, auth, schema,
dependencies, Playwright config, shared E2E helper, diagnostic registry, fixture
guards or any other CMS case. The application still controls whether the native
dialog appears; the test does not bypass its handler.

## After-fix evidence and validation

The otherwise unchanged isolated Playwright runner reproduction, with the same
60s/10s budgets, passed after using the replacement trigger:

| After-fix operation | Node elapsed from test body |
|---|---:|
| Enter sequence | 171 ms |
| Native beforeunload appears | 184 ms |
| Dismiss completes | 187 ms |
| Native trigger promise fulfills | 192 ms |
| Page open/input intact verified | 193 ms |
| Promise.all completes | 194 ms |
| Case result | **PASS**, duration 346 ms, exit 0 |

Added an explicit, repeatable standalone reproduction at
`tests/browser-local/cms-auto21-navigation.mjs`. It is outside both CMS discovery
and the normal `tests/*.test.mjs` unit glob. It tests browser behavior with
synthetic data, not CMS application or database success. The baseline must reject
with the expected bounded TimeoutError; all other errors fail, and errors from
the fixed trigger propagate. Every started operation is awaited before context
closure. Four scenarios passed in the final run:

| Trigger / clock | Dialog / dismiss | Trigger settled | Post-await input |
|---|---|---|---|
| Reload waiter / paused | 10 / 13 ms | Expected TimeoutError, 2,014 ms | Retained, page open |
| Native trigger / paused | 4 / 6 ms | Fulfilled, 7 ms | Retained, page open |
| Reload waiter / running | 6 / 7 ms | Expected TimeoutError, 2,011 ms | Retained, page open |
| Native trigger / running | 5 / 6 ms | Fulfilled, 8 ms | Retained, page open |

Both paused variants verify zero synthetic saves at 1,999 ms, exactly one at
2,000 ms with the original text, and still one after another 5,000 ms. These
checks show native cancellation preserves the live document and timer in the
reproduction; the unchanged staging assertions must still prove the actual CMS
controller/request/DB behavior on the patched commit.

All commands ran through a filtered child environment with dummy database/auth
settings, `DOTENV_CONFIG_PATH=NUL`, `.env*` read blocking and DB-port blocking.
Staging credential/environment variables were not forwarded. Chromium used a
fresh temporary context/profile, not an existing authenticated browser profile.
No package/browser download or `.env` read occurred.

Exact prepared Node executable:

```text
C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe
```

The existing ignored local wrapper is
`.next/cms006-local-20260926-05e7d1/run.cjs`; it launches installed CLIs with an
OS-variable allowlist and explicit dummy configuration. `$Node22` below refers
to the executable above. Do not run the local probe in a credential-bearing
staging process; use that wrapper or an equivalent fresh filtered child.

| Command through the sanitized wrapper | Result |
|---|---|
| `$Node22 run.cjs auto21-runner-before node_modules/playwright/cli.js test --config=.next/cms006-auto21-local-20260926/runner-repro.config.mjs` | Expected reproduction **timedOut**, exit 1; no CMS suite loaded. |
| `$Node22 run.cjs auto21-runner-after node_modules/playwright/cli.js test --config=.next/cms006-auto21-local-20260926/runner-after.config.mjs` | **PASS**, 1 synthetic case, exit 0. |
| `$Node22 run.cjs auto21-regression tests/browser-local/cms-auto21-navigation.mjs` | **PASS**, all four comparison scenarios, exit 0. |
| `$Node22 run.cjs auto21-lint npm run lint` | **PASS**, exit 0. |
| `$Node22 run.cjs auto21-typescript node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS**, exit 0. |
| `$Node22 run.cjs auto21-discovery npm run test:e2e:list` | **PASS discovery**, exactly 36 CMS cases; not CMS browser PASS. |
| `git diff --check` and explicit new-file whitespace/conflict checks | **PASS**, exit 0; index empty. |

Ignored before/after runner configs/specs and small probe artifacts are under
`.next/cms006-auto21-local-20260926/`; filtered logs use the `auto21-*` labels in
`.next/cms006-local-20260926-05e7d1/`. They are not staged. The retained standalone
script allows the four-way browser comparison without those temporary configs.

Full unit suite, Prisma generate/validate and production build: **NOT RUN in this
fix round**. Only one browser-test trigger/comment and isolated probe/report were
changed; no application, helper, diagnostic or dependency change requires those
broader gates. Prior commit results remain historical, not new-patch evidence.

## Files, handoff and limitations

| File | Change |
|---|---|
| `tests/e2e/cms-autosave.spec.ts` | Minimal AUTO-21 native reload trigger; remove catch-all timeout suppression. |
| `tests/browser-local/cms-auto21-navigation.mjs` (new) | Repeatable synthetic browser comparison with Node timings, real dialogs and debounce checks. |
| `docs/cms/reports/CMS-006-auto21-navigation-fix.md` (new) | Cause, supplied staging vs local evidence, validation and pending gates. |

Claude should review the installed Playwright mechanism, the original 60-second
timeout reproduction and misleading later assertion location, the fixed native
trigger's actual promise settlement, and preservation of every remaining AUTO-21
request/DB/navigation assertion. This local test fix does not establish that the
complete staging scenario now passes or exclude a later application-specific
issue. **Claude review, CI and staging of the patch are NOT RUN.**

Final Git status:

```text
## feature/cms-006-autosave...origin/feature/cms-006-autosave
 M tests/e2e/cms-autosave.spec.ts
?? docs/cms/reports/CMS-006-auto21-navigation-fix.md
?? tests/browser-local/cms-auto21-navigation.mjs
```

HEAD stays `d9e08e7d81e90666c5e3d5b7edfc14c8baf0ca69`; ahead/behind the local
origin tracking ref is 0/0 (no fetch/push needed in this local fix). All three
changes remain **UNSTAGED**. Existing global-ignore permission/LF-to-CRLF notices
from Git were not changed into a configuration or source-policy modification.
No commit/push/merge/deploy, SSH, DB connection, fixture, migration, seed or cleanup.
CMS-006 remains **NOT COMPLETE**; CMS-005 authenticated smoke stays **DEFERRED**.
