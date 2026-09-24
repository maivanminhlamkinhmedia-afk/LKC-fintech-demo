# CMS-005 — Safe staging diagnostics implementation report

Date: 2026-09-24. Status: **local validation PASS; independent review pending**.
CMS-005 remains **NOT COMPLETE**. This patch adds diagnostics only; it does not
claim to fix either browser failure.

## Baseline and earlier staging evidence

- Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`.
- Workspace: `D:\lkc_phase1_rbac_patch\LKC-fintech-demo`.
- Branch: `feature/cms-005-draft-editor-tiptap`.
- HEAD before and after this patch: `7bdee2e22891942235c3f1eb2c01dfc414a473bf`.
- Existing draft PR: [#20](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/20).
- Preflight matched the requested branch/commit and had a clean working tree.
  No reset, clean, stash, or overwrite of user changes was performed.

The following evidence was supplied by the user from Claude staging QA; it was
**not rerun locally**:

| Evidence | Earlier staging result |
|---|---|
| Commit | `7bdee2e22891942235c3f1eb2c01dfc414a473bf` |
| runId | `50edda4dd148bf115c08eb60` |
| Runtime | Node `v22.23.2`, Playwright `1.63.0` |
| Browser suite | **18 passed / 2 failed / 0 skipped** |
| Failed case 1 | `EDIT-04/05/06/21 create and refresh Vietnamese formatting with no writes from GET or typing` |
| Failed case 2 | `EDIT-18 real HTML clipboard paste removes unsafe content and persists canonical safe links` |
| EDIT-13 concurrency | **PASS on that staging commit** |
| EDIT-14 MariaDB DATETIME(3) | **PASS on that staging commit** |
| Cleanup | `CMS_E2E CLEANUP {"articles":0,"profiles":0,"users":0,"logs":0}` |
| Final result | `CMS_E2E STOP BROWSER_SUITE_FAILED`; **no `CMS_E2E VERIFIED`** |
| Post-run state | Claude reported active lock released, app on port 3001 stopped, working tree clean |

The specifically authorized metadata file was available:
`.next/cms-e2e-build-50edda4dd148bf115c08eb60/.next/cms-e2e-build.json`.
Its recorded commit was `7bdee2e22891942235c3f1eb2c01dfc414a473bf`, and its
`buildId` was `TJjteYUBh_bDIFfDeQAcr`. Only this metadata was read from the old
snapshot. The snapshot was not rebuilt, deleted, or otherwise cleaned.

The cause of **both failures remains UNDETERMINED**. In particular,
`locator('strong').toContainText(...)` might match multiple elements; this is an
unconfirmed suspicion, not an established cause or severity finding. The locator
and assertion remain unchanged, with no added `.first()`.

## Scope and changed files

The task/spec, implementation guidance, roadmap, existing implementation report,
AGENTS.md, runbook, relevant harness/tests, and editor source were consulted.
The existing 30 acceptance criteria and 24 EDIT scenarios remain unchanged.

| File | Change |
|---|---|
| `scripts/cms-e2e/diagnostics.mjs` (new) | Fixed case/step registry, strict diagnostic schema, location allowlist, bounded stdout decoder/filter |
| `scripts/cms-e2e/run.mjs` | Replace prefix-only browser stdout forwarding with the strict filter |
| `tests/e2e/safe-reporter.mjs` | Emit safe case IDs, controlled step outcomes, separately labelled API locations; suppress raw channels |
| `tests/e2e/cms-draft.spec.ts` | Add 15 awaited static steps to EDIT-04/05/06/21 |
| `tests/e2e/cms-editor-safety.spec.ts` | Add 29 static steps to EDIT-18, including clipboard permission and separate initial/reload DOM checks |
| `tests/cms-e2e-diagnostics.test.mjs` (new) | 15 synthetic unit tests for reporter/filter behavior and sensitive-data exclusion |
| `tests/README.cms-e2e.md` | Diagnostic protocol, evidence interpretation, local safety, and exact-commit review/CI staging gate |
| `docs/cms/reports/CMS-005-staging-diagnostics.md` (new) | This handoff report |

No application source, dependency pins, Prisma schema/migrations, RBAC,
Playwright configuration, global setup, fixture/cleanup code, or staging guard
was changed. Original test data, operation order, assertions, native clipboard
write/paste, and keyboard interactions remain intact. No timeout/retry increase,
new skip/only, assertion relaxation, or browser interaction replacement was added.

## Diagnostic design

The two affected tests use 44 exact, static `test.step` codes. Formatting steps
cover login/input, bold/list/code, no-write checks, save/navigation, stored data,
reload/DOM, and list/dashboard links. Clipboard steps cover permission, input,
clipboard write, native paste, each safe-link/unsafe-DOM assertion, persistence
and canonicalization, and reload. The full code list is in the runbook.

The reporter resolves exact known title/file pairs to 20 static case IDs.
Unknown cases use `UNKNOWN_CASE` and keep their status without exposing their
title. Step codes are accepted only for their owning case. Only explicit approved
`test.step` entries and failed `expect` leaves inside those steps emit diagnostics;
automatically generated assertion/API titles are not emitted.

Protocol record types are `CMS_E2E DISCOVERY`, `CASE`, `DIAGNOSTIC`, and `RESULT`,
followed by a validated JSON object. Records contain only the approved identifiers,
status enums, discovery count, and these distinct location fields:

- `testLocation`: test declaration supplied by Playwright.
- `stepLocation`: approved enclosing `test.step` callsite.
- `assertionLocation`: failed expect leaf's structured `error.location`, or its
  own `step.location` when no approved error location is available.
- `assertionSource`: `error.location`, `step.location`, or `null`, to explain the
  coordinate's provenance.

Only the two repository-relative spec paths are permitted, with positive safe
integer line/column values capped at 1,000,000. Absolute API paths are normalized
to those approved relative paths. Missing/disallowed locations become `null`.
The code does not parse stacks, guess a failure line, or use the test declaration
as an assertion location. A callsite fallback is not represented as a proven
exact throwing instruction. Both a failed leaf and its enclosing controlled step
may emit a record; the CASE result remains the browser-case outcome.

The runner parses and revalidates complete stdout records, checks exact keys,
types, enums, case/step pairing and location schemas, and reserializes accepted
objects. A matching prefix alone is insufficient. Unknown/extra fields, malformed
JSON, unsafe paths and free text are dropped. The decoder handles chunked UTF-8
and CRLF, caps each line at 4,096 characters, discards oversized lines through the
next newline, and drops an unterminated final fragment. Raw stderr stays discarded.

Diagnostics do not catch assertions or override `onEnd` with a replacement
verdict. Failed/timed-out case statuses remain failed/timed-out. The runner still
requires Playwright's real process exit code to be zero and fixture cleanup to be
verified before it can emit `CMS_E2E VERIFIED`.

## Sensitive-data and regression evidence

The 15 new unit tests use synthetic callbacks/data only; they do not start a
browser, instantiate a real database, create fixtures, or invoke staging cleanup.
They verify:

- All 44 step codes accept their owning case and reject cross-case/suffixed codes;
  all 20 exact case identities retain their outcomes.
- Unknown fields/types/statuses, forged records, unsafe paths/coordinates and
  conflicting assertion-source metadata are rejected.
- Failed case/suite outcomes are retained, and `onEnd` returns no status override.
- Sensitive getters for message, stack, cause, expected/actual, generated metadata,
  attachments and stdout/stderr are never accessed. Synthetic private text in
  raw/generated titles and output channels does not reach output.
- Forged protocol lines arriving through reporter stdout/stderr callbacks are
  ignored. Reporter-to-filter integration preserves only safe failure records.
- Failed assertion API locations and fallback provenance remain distinct; missing
  locations are not invented. Parent resolution handles unknown/cyclic parents.
- Every byte split, mixed string/Buffer input, split CRLF, Vietnamese/CJK/emoji
  multibyte boundaries, malformed/oversized lines and truncated final records are
  handled without forwarding private text or losing subsequent valid records.

These are local synthetic proofs of the allowed output boundary, not proof of
the two browser cases passing. Runtime location usefulness still needs the next
authorized staging run.

The unchanged browser safety settings remain trace/video/screenshot off,
`preserveOutput: 'never'`, `PLAYWRIGHT_NO_COPY_PROMPT=1`, one worker and zero
retries. Staging target/provenance, lock, manifest, fixture and cleanup safeguards
remain in place.

## Local validation

All validation subprocesses used the already prepared Node **v22.23.2** at:

```text
C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe
```

The child environment was constructed from an OS-variable allowlist, rather than
forwarding inherited staging variables. Each child received the dummy
`DATABASE_URL=mysql://build:build@127.0.0.1:3306/build`, `DOTENV_CONFIG_PATH=NUL`,
dummy auth settings, disabled telemetry/browser downloads, and cleared sheet/mail
integration settings. npm user/global configuration paths pointed to unused files
in the fresh local validation directory. A process-local Node preload blocked
`.env*` reads and socket connections to ports 3306/3307. No environment values
were dumped and no `.env` or secret file was read.

Below, `$Node22` denotes that exact executable and `$NpmCli` its sibling
`node_modules\npm\bin\npm-cli.js`. The commands were launched through a child
process wrapper with the environment described above; this runs the existing npm
scripts without resolving a different Node version from PATH or installing tools.

| Validation command | Exit | Actual result |
|---|---:|---|
| `$Node22 --version` | 0 | **PASS**, `v22.23.2` |
| `$Node22 $NpmCli run test:unit` | 0 | **PASS**, 411/411; 0 failed, 0 cancelled, 0 skipped, 0 todo (396 existing + 15 diagnostic tests) |
| `$Node22 $NpmCli run lint` | 0 | **PASS**, including the final UTF-8/CRLF test |
| `$Node22 node_modules/typescript/bin/tsc --noEmit --incremental false` | 0 | **PASS** |
| `$Node22 $NpmCli run build` in the fresh snapshot below | 0 | **PASS**, production compilation, type check and prerendering completed |
| `$Node22 $NpmCli run test:e2e:list` | 0 | **PASS discovery**, exactly 20 cases; no browser execution |
| `git diff --check` | 0 | **PASS** for tracked changes |

The three new untracked files were also checked individually with
`git diff --no-index --check -- NUL <exact file>`: no whitespace-error diagnostics.
Those commands return 1 because the new file differs from NUL; that is not the
exit code of the successful tracked `git diff --check`. Git also emitted the
workspace's LF-to-CRLF notices; no line-ending policy was changed.

Discovery emitted `CMS_E2E DISCOVERY {"count":20}` and a discovery-only
`CMS_E2E RESULT {"status":"passed"}`. This is **not a browser PASS**.

The production build uses 144 allowlisted current tracked `src/`/`public/` and
named configuration files in the new env-free snapshot:
`.next/cms005-diagnostics-local-20260924-a942c7/build-node22`.
Its `node_modules` junction targets already installed dependencies. No package
install or staging runner was used. Local validation logs/preload/build artifacts
are ignored under `.next/cms005-diagnostics-local-20260924-a942c7/` and are not part
of this patch.

Next.js reported the existing root lockfile plus the snapshot lockfile when
inferring its workspace root. The build still completed successfully; no runtime,
dependency or Next.js configuration was changed to suppress that warning.

The first snapshot preparation attempt stopped before copying/building because
the sanitized subprocess environment did not carry Git's sandbox ownership
exception (Git exit 128; wrapper exit 1). A subsequent read-only
`git -c safe.directory=<exact workspace> ls-files -z -- src public` supplied the
exception for that one command, then created a different fresh snapshot. No Git
configuration or source was changed to recover. The empty initial directory and
all old snapshots were retained.

## Pending work and independent review handoff

| Activity | Status |
|---|---|
| Browser staging on this diagnostic patch | **NOT RUN / STAGING PENDING** |
| New MariaDB concurrency/precision/cleanup run on this patch | **NOT RUN**; earlier commit's PASS evidence is recorded separately above |
| Claude independent review of this patch | **PENDING** |
| Commit/push and CI for this exact patch | **NOT RUN** in this handoff |
| CMS-005 overall | **NOT COMPLETE** |

Claude should review instrumentation for identical operations/data/assertions;
the exact case/step/location allowlists; actual Playwright 1.63 location semantics;
all raw-output suppression and stream failure paths; failure-verdict preservation;
and the unchanged artifact/provenance/fixture/cleanup controls. Review the synthetic
tests and distinguish earlier staging evidence from local discovery and from the
not-yet-run patch.

After independent review, separately authorized commit/CI must PASS for the
**exact diagnostic patch commit** before Claude staging QA. The next authorized
run should use the safe case/step/location records to identify the failing stage,
preserve the real suite outcome, and verify cleanup. No causal fix should be
inferred merely from this patch or the earlier staging summary.

## Final working-tree status and confirmations

Final `git status --short`:

```text
 M scripts/cms-e2e/run.mjs
 M tests/README.cms-e2e.md
 M tests/e2e/cms-draft.spec.ts
 M tests/e2e/cms-editor-safety.spec.ts
 M tests/e2e/safe-reporter.mjs
?? docs/cms/reports/CMS-005-staging-diagnostics.md
?? scripts/cms-e2e/diagnostics.mjs
?? tests/cms-e2e-diagnostics.test.mjs
```

Five modified tracked files and three new untracked files; nothing staged.
`git diff --cached --stat` was empty. Protected application/schema/dependency and
guard/fixture/configuration paths had no diff. HEAD remains
`7bdee2e22891942235c3f1eb2c01dfc414a473bf`. Git reported a sandbox permission warning
for the user's global ignore file; `git status` itself completed successfully.

No git add, commit, push, merge or deploy. No schema/migration changes, database
connection/query, fixture creation, staging/SSH run, seed or cleanup operation.
No CMS-004 cleanup and no deletion/rebuild of the old staging snapshot. No package
or browser installation. CMS-005 was not marked COMPLETE.
