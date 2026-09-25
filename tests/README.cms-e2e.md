# CMS staging E2E — CMS-005

This is a **staging-only** harness. Local implementation/review runs unit mocks,
lint/type checks and discovery only. No database, browser installation, tunnel or
staging run is part of local validation. CMS-004 fixtures were already cleaned;
do not run its cleanup script or recreate its accounts.

## Safe local checks

```powershell
$env:DATABASE_URL = 'mysql://build:build@127.0.0.1:3306/build'
$env:DOTENV_CONFIG_PATH = 'NUL'
node --test tests/cms-e2e-harness.test.mjs
node --test tests/cms-e2e-diagnostics.test.mjs
npx.cmd playwright test --list
```

The imports and discovery do not instantiate Prisma, read env files, start an
application, create fixtures or launch a browser. A discovery result is **not an
E2E pass**. The checked-in config uses Chromium, one worker, no retries, and no
automatic `webServer`/server reuse.

## Preconditions for a separately authorized staging run

1. Claude review and PR CI have passed for the exact committed checkout.
2. Dependencies match the lockfile. Node 22 must be a recent 22.x supporting the
   repository's native TypeScript and `registerHooks` tests. Do not change runtime
   major versions to hide test failures.
3. An operator has opened the approved existing staging tunnel at
   `127.0.0.1:3307`. The harness never opens SSH itself.
4. Database identity is `edpmjmha_lkcstage`, database username
   `edpmjmha_lkcstg`. No production/evaluation URL or credentials are accepted.
5. Port `127.0.0.1:3001` is free. The runner refuses a busy port and never kills
   or reuses an unknown application.
6. Install the matching Chromium browser **during this separately authorized
   staging phase**, if it is not already installed:

```powershell
npx.cmd playwright install chromium
```

No browser install is performed by the harness or a PR CI job. Do not add staging
secrets to the PR workflow.

## Process-local configuration and execution

Use a fresh PowerShell process. Do not read `.env` or paste secrets into chat,
logs, shell arguments or a report. Enter the staging password privately through
the credential prompt; the resulting URL exists only in this shell's environment.

```powershell
$cmsStageCredential = Get-Credential -UserName 'edpmjmha_lkcstg' -Message 'Approved staging database password'
$cmsStagePassword = [Uri]::EscapeDataString($cmsStageCredential.GetNetworkCredential().Password)
$env:DATABASE_URL = "mysql://edpmjmha_lkcstg:$cmsStagePassword@127.0.0.1:3307/edpmjmha_lkcstage"
$env:E2E_BASE_URL = 'http://127.0.0.1:3001'
$env:NEXTAUTH_URL = 'http://127.0.0.1:3001'
node scripts/cms-e2e/run.mjs --staging --ci-reviewed
```

Do not print the credential variables or use a transcript that records input.
After the run, close this shell or clear these process-local values:

```powershell
Remove-Item Env:DATABASE_URL, Env:E2E_BASE_URL, Env:NEXTAUTH_URL -ErrorAction SilentlyContinue
$cmsStagePassword = $null
$cmsStageCredential = $null
```

The two runner flags attest that the operator reached the separately approved
staging phase after review/CI. They are not a substitute for those approvals.

The wrapper performs the following ordered operations:

1. Parse/validate exact base/auth URLs and the database URL before any connection.
   Query options, fragments, alternate hosts/ports/users/databases are rejected.
2. Refuse a busy app port, dirty tracked checkout or untracked app build inputs.
   Acquire an exclusive per-repository run lock.
3. Copy only tracked `src/`, `public/` and named build configuration files into an
   env-free `.next/cms-e2e-build-<runId>` snapshot. Installed dependencies are linked
   through a junction; no package install occurs. The app build gets a dummy
   database URL, never staging credentials. No env files are copied/read.
4. Record the exact Git HEAD and new `BUILD_ID`, and recheck checkout provenance.
5. Lazily create the staging Prisma client; verify `SELECT DATABASE()` and
   `CURRENT_USER()` against the allowlist before fixture writes.
6. Write a run manifest, then create exactly six accounts and the declared article
   fixtures in a Serializable transaction. Passwords are random in memory; only
   hashes enter the database. No AuthorProfile is created, exercising that case.
7. Start the snapshot's production app through Node's Next CLI with explicit
   `--hostname 127.0.0.1 --port 3001`. Windows never invokes the Unix-style npm
   `start` script. Runtime receives the validated staging URL and a fresh auth
   secret. Readiness must come from this child process before HTTP checks begin.
8. Run the real browser suite. Credentials pass to the child/worker in process
   environment only, not in a JSON credential file. Each actor gets an isolated
   browser context and authenticates through the existing login UI.
9. Stop only the app child started by this runner, discover/record any UI-created
   articles belonging to the six exact fixture users, and perform verified cleanup
   in `finally`, whether browser tests passed or failed.

Run lock, manifests and build snapshots are ignored artifacts. Manifests contain
run IDs, fixture user identities and exact article IDs/approved fixture owners;
they do not contain passwords, password hashes, cookies or auth state. Article
IDs remain tracked when the test changes a slug. Browser-created slugs must retain
the run namespace; unexpected ownership or namespace changes stop cleanup.

## Cases and evidence levels

The browser suite uses actual login, Server Actions and MariaDB—no network,
permission, action or database mocks. It covers:

- EDIT-01 and CLIENT/ANALYST route denial from EDIT-02.
- EDIT-04/05/06: manual create, no GET/typing writes, Vietnamese/marks/list/code
  round-trip and refresh.
- EDIT-07/08/09/10: foreign creator denial, editable states, admin/super access
  preserving author, and all eight excluded workflow states.
- EDIT-11/12: guarded fixture changes to actor status/role and article status/owner
  while an editor is already open; subsequent saves must not change the row.
- EDIT-13: two tabs save concurrently using the same loaded token; one wins and
  the other keeps its draft with `EDIT_CONFLICT`.
- EDIT-14: a fixture timestamp deliberately ahead of wall clock exercises
  `previous + 1 ms` twice through real Server Actions and MariaDB `DATETIME(3)`.
  This verifies precision and the monotonic fallback; it does **not** claim two
  physical HTTP requests completed inside one wall-clock millisecond.
- EDIT-15/16: canonical slug collision and blank body with no AuthorProfile.
- EDIT-18/20: real clipboard HTML paste with unsafe markup, and an actual offline
  browser context while saving; verify safe stored attributes, retained draft,
  no database write, dirty navigation dismissal and successful retry.
- EDIT-21/22: scoped dashboard/list links and actual own count, 390/768/1280px
  editor width, no document overflow, code-block internal horizontal scrolling
  and keyboard/toolbar behavior.

Malformed payloads, JSON limits, unsafe links, ownership injection and internal
failure paths additionally belong to the pure/action suite. Browser route denial
alone does not prove mutation authorization or SQL isolation. Record results at
their actual level; a mocked cleanup test does not mean real cleanup succeeded.

`tests/cms-e2e-harness.test.mjs` uses in-memory mocks only to verify EDIT-23/24
guards, exact-ID mutations, relation protection, rollback control flow, cleanup
after PASS/FAIL, and post-commit verification handling.

## Cleanup and interrupted-run recovery

Normal cleanup revalidates both URL and actual server identity. It refuses:

- an article owned outside its manifest-approved exact users;
- unrecognized article IDs or unrelated/non-namespaced records;
- article taxonomy/history/review/media links or other related rows;
- unplanned AuthorProfiles, CRM/customer/team or other User relations;
- audit records other than `AUTH_LOGIN` for the exact fixture User itself.

It deletes only validated exact login-log IDs, article IDs, then User IDs; no
prefix-wide delete, FK disabling, migration, generic seed or cascade workaround.
The baseline creates no AuthorProfiles, so an unexpected one stops cleanup instead
of being deleted. Counts for exact fixture articles/profiles/users/login logs must
all be zero inside the transaction and again after commit. Any cleanup failure
makes the staging result fail, even if all browser cases passed.

If the runner is forcibly terminated, retain the manifest and inspect the ignored
`playwright/.cms-e2e/active.lock` (runId, parent PID, app PID, commit only). Verify
those process identities before manually stopping a surviving app. Do not kill an
unknown listener or remove another operator's active lock. Recovery `--apply`
also refuses a busy port.

If fixture creation itself failed or its commit response was uncertain, automatic
cleanup deliberately refuses deletion. A colliding pre-existing identity is not
assumed to belong to this run. Review the read-only manifest/identity evidence
before authorizing recovery; never apply cleanup merely to clear a setup error.

After restoring the same privately configured staging environment, replace the
placeholder below with the exact interrupted manifest path:

```powershell
node scripts/cms-e2e/cleanup.mjs --manifest playwright/.cms-e2e/<runId>.json
node scripts/cms-e2e/cleanup.mjs --manifest playwright/.cms-e2e/<runId>.json --apply
```

The first command is read-only. If it reports unrecorded UI rows after a lost
response, the explicit apply path discovers records only by the six exact owned
User IDs, verifies their run namespace, persists their exact IDs, and then runs
the same restrictive cleanup. Never widen a failing preflight to force cleanup.
If an unexpected relation/owner exists, stop for review. Once the operator has
verified the matching runner is gone and `CLEANUP_VERIFIED` reports all zeros,
the exact stale `active.lock` can be removed manually. Completed manifests remain
for evidence; do not rerun CMS-004 cleanup.

## Reports and secrets

Trace/video/screenshots and persisted authentication state are disabled. The
runner sets `PLAYWRIGHT_NO_COPY_PROMPT=1`, and global setup refuses execution if
that guard is missing. The pinned Playwright 1.63 otherwise captures automatic
AI aria snapshots in `error-context.md`, which can contain input values even with
tracing off. Config also uses `preserveOutput: 'never'`; review this suppression
again before changing the Playwright pin. No automatic error-context artifact is
permitted during login. The
reporter emits only allowlisted case IDs, static step codes, status enums, approved
relative source locations and discovery counts. Login errors
are replaced with a role-only diagnostic; app/build diagnostics and Playwright
call logs are not forwarded. Never upload raw test-results, auth state, browser
traces, manifests, unreviewed screenshots or process environment dumps.

Attach only reviewed output containing commit/runId, case results and zero cleanup
counts. `CMS_E2E VERIFIED` is emitted only after browser success and verified
cleanup. Any `STOP`, failed case or nonzero remaining count means staging is not
PASS. For a patched commit that has not been run, report **STAGING PENDING /
browser NOT RUN**, even if an earlier commit has staging evidence.

## Safe diagnostics for the two unresolved cases

The reported staging run `50edda4dd148bf115c08eb60` tested commit
`7bdee2e22891942235c3f1eb2c01dfc414a473bf` with Node 22.23.2 and Playwright
1.63.0: 18 passed, 2 failed, 0 skipped. The failed cases were the formatting
round-trip (EDIT-04/05/06/21) and native HTML clipboard paste (EDIT-18).
EDIT-13/14 passed, and fixture cleanup reported all four counts as zero, but the
suite ended `BROWSER_SUITE_FAILED` without `CMS_E2E VERIFIED`. These are supplied
staging results, not a local replay. The cause of either failure remains
**UNDETERMINED**; the diagnostic patch changes no application behavior or assertions.

Use the already prepared **Node 22.23.2** for local patch validation. Override
`DATABASE_URL` with the dummy value in each validation subprocess; never inherit
the staging URL from an editor terminal. A production build must use a new
env-free source snapshot with dummy environment settings. Do not read `.env`,
rebuild/delete the earlier staging snapshot, or invoke the staging wrapper locally.

The two tests now use awaited `test.step` wrappers with 44 fixed codes:

| Case | Codes in execution order |
|---|---|
| EDIT-04/05/06/21 | `FMT_LOGIN`, `FMT_INPUT`, `FMT_BOLD`, `FMT_LIST`, `FMT_CODE_BLOCK`, `FMT_NO_WRITE`, `FMT_SAVE_NAVIGATE`, `FMT_DB`, `FMT_RELOAD`, `FMT_DOM_TEXT`, `FMT_DOM_BOLD`, `FMT_DOM_LIST`, `FMT_DOM_CODE`, `FMT_LIST_LINK`, `FMT_DASHBOARD` |
| EDIT-18 setup/paste | `CLIP_LOGIN` (contains `CLIP_PERMISSION`), `CLIP_INPUT`, `CLIP_WRITE`, `CLIP_NATIVE_PASTE` |
| EDIT-18 DOM | `CLIP_DOM_TEXT`, `CLIP_LINK_COUNT`, `CLIP_LINK_HREF`, `CLIP_LINK_TARGET`, `CLIP_LINK_REL`, `CLIP_LINK_CLASS`, `CLIP_LINK_TITLE`, `CLIP_DANGEROUS_ELEMENTS`, `CLIP_EVENT_ATTRIBUTES`, `CLIP_SCRIPT_EXECUTION` |
| EDIT-18 save/reload | `CLIP_SAVE_NAVIGATE`, `CLIP_DB_CANONICAL`, `CLIP_DB_LINKS`, `CLIP_RELOAD`, then the ten DOM checks with the explicit `CLIP_RELOAD_...` codes |

The test order, payloads, native keyboard/clipboard interactions and assertions
are retained. No `.first()` was added to the `strong` locator, no assertion was
weakened, and no timeout/retry/skip setting was changed. Any existing unrelated
`.first()` remains unchanged.

Reporter protocol lines use `CMS_E2E DISCOVERY`, `CASE`, `DIAGNOSTIC`, or `RESULT`
followed by a JSON object. Case titles must match the fixed title/file registry
exactly to become a known case ID; other titles become `UNKNOWN_CASE`, preserving
their outcome without printing their text. Explicit step titles must be exact
allowlisted codes for that case. Auto-generated Playwright step names/parameters
are never output. Successful controlled steps report `passed`; failed controlled
steps and failed `expect` leaves report `failed`. A leaf and its enclosing step
may both report failure; this does not count as two failed browser cases.

Location fields have deliberately distinct meanings:

- `testLocation`: Playwright's test declaration location.
- `stepLocation`: the enclosing approved `test.step` callsite.
- `assertionLocation`: for a failed `expect` leaf only, its structured
  `error.location`, or its own `step.location` if no approved error location exists.
- `assertionSource`: `error.location` or `step.location`, identifying which API
  field supplied the coordinate; `null` if none is available.

Only `tests/e2e/cms-draft.spec.ts` and `tests/e2e/cms-editor-safety.spec.ts`
with positive integer line/column values are allowed. Absolute source paths are
normalized to these approved repository-relative paths. Missing/disallowed
locations are `null`; no stack parsing, line-number guessing or substitution of
the test declaration as an assertion location occurs. A callsite fallback is not
a claim that it is the exact instruction that threw. A failure outside a
controlled step may only have the CASE record; inspect what the API actually supplied.

The runner reparses every candidate stdout line and checks exact keys, enums,
case/step pairing and location schemas before reserializing it. Extra properties,
invalid metadata, free text and unknown record types are dropped even if they
start with `CMS_E2E`. The streaming buffer is capped at 4,096 characters per line;
oversized lines are discarded through the next newline, and an unterminated final
fragment is dropped. Split UTF-8/CRLF chunks are handled without opening raw stdout.
Raw stderr remains discarded. The reporter ignores stdout/stderr callbacks,
attachments, error messages/stacks/causes, expected/actual values, HTML/editor
content and request/response/cookie/credential data.

Diagnostics never catch a failing test assertion or override `onEnd` status.
The runner still requires the actual Playwright process exit code to be zero
before success, plus verified fixture cleanup. No diagnostic record alone proves
a suite PASS. Unit tests exercise synthetic failures, hostile output metadata
and chunk boundaries without starting Playwright/browser/DB.

The next staging run requires **Claude independent review and CI PASS for the
exact diagnostic patch commit**, followed by separately authorized Claude staging
QA. The previous commit's CI/staging results do not satisfy that gate. Keep the
existing trace/video/screenshot suppression, `preserveOutput: 'never'`,
`PLAYWRIGHT_NO_COPY_PROMPT=1`, one worker, zero retries, provenance, lock and fixture
guards. Do not run CMS-004 cleanup. See
[diagnostic implementation report](../docs/cms/reports/CMS-005-staging-diagnostics.md).
