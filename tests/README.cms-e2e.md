# CMS staging E2E — CMS-005 and CMS-006

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

The browser suite uses actual login, Server Actions and MariaDB. No permission,
action result or database success is fabricated. The CMS-005 cases cover:

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
- EDIT-18/20: real clipboard HTML paste with unsafe markup, and a browser context
  taken offline after a real action dispatch; verify safe stored attributes, retained draft,
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

## CMS-006 autosave source and evidence mapping

The suite retains all 20 CMS-005 cases and adds 16 CMS-006 cases: **36 expected
discovered browser tests**, with zero retries. Discovery is not browser evidence.
The CMS-006 browser suite is **NOT RUN** during local implementation. The supplied
CMS-005 release checkpoint remains its own historical evidence; a future run must
use a new run ID, exact reviewed CMS-006 commit and fresh build provenance.

The new tests install Playwright's browser clock before opening an editor, pause
it after hydration, and explicitly advance the 2-second debounce. The initial
pause jumps fake time forward 60 seconds only on a clean/new editor before edits
or composition, or on the destination after confirmed leave. This avoids a stale
absolute pause target between protocol calls; it is not a wall-time wait or a
timeout/retry increase. There is no
application test flag or disabled autosave. `holdActionResponses` forwards the
unchanged authenticated request with `route.fetch()` to the actual app/DB, then
delays that actual response or aborts its delivery. It never creates a successful
action payload. The lost-ACK case verifies the committed row before dropping the
response, then verifies a deliberate stale-token retry conflicts. Request counts
exclude GET/revalidation traffic and login actions.

| AUTO scenarios | Browser case IDs and controlled step codes | Browser assertions |
|---|---|---|
| 01, 02 | `AUTO-01/02` / `AUTO_CREATE_IDLE` | New typing/idle makes no row; double-click creates once; edit load, focus, selection, link UI and idle do not write; persisted edit enables autosave. |
| 03, 04, 18 | `AUTO-03/04/18` / `AUTO_RICH_ROUNDTRIP` | Latest five fields only after deadline; uppercase slug canonicalizes without looping; native HTML clipboard preserves Vietnamese heading/link/list/code and whitespace through DB/reload; blank body remains valid. |
| 05, 06, 07, 23 | `AUTO-05/06/07/23` / `AUTO_SINGLE_FLIGHT` | Two held real ACKs; typing, formatting and undo/redo remain usable; one in-flight plus one latest follow-up; newer slug, title caret and editor DOM/history survive ACK; persisted token advances. |
| 07 | `AUTO-07` / `AUTO_MANUAL_FLUSH` | Manual flush before deadline, double-click and clean clicks do not duplicate updates. |
| 10 | `AUTO-10` / `AUTO_SLUG_BARRIER` | Collision makes no write; body changes do not retry the same conflicting slug; edited valid slug resumes. |
| 11, 21 | `AUTO-11` / `AUTO_OFFLINE_REARM` | Known offline makes no action; latest draft and dismissed navigation survive; online rearms exactly one debounce. |
| 12 | `AUTO-12` / `AUTO_UNKNOWN_ACK` | Commit with lost real response remains uncertain; timer/online never retries; explicit stale retry conflicts and preserves local draft. |
| 13, 21 | `AUTO-13` / `AUTO_TWO_TABS` | Concurrent tabs have one winner; loser keeps draft without retry; link dismissal and reload cancel preserve it; confirmed reload shows winner. |
| 14 | `AUTO-14-ADMIN`, `AUTO-14-SUPER` / `AUTO_ADMIN_SCOPE`; `AUTO-14-REVOKED` / `AUTO_REVOKED_ACTOR` | Admin scope preserves foreign author; suspended/demoted active editors stop; client/analyst/foreign creator routes deny. |
| 15 | `AUTO-15` / `AUTO_CHANGED_POLICY` | Guarded status/owner changes reject stale editor writes and stop subsequent automatic queueing. |
| 16 | `AUTO-16` / `AUTO_EXPIRED_SESSION` | Real browser cookies removed; safe forbidden response keeps route/input and stops queue. No-Article-query ordering is proven in local action tests, not inferred from the browser. |
| 19 | `AUTO-19` / `AUTO_COMPOSITION` | DOM composition events on title and contenteditable exceed debounce without write; end rearms one save. Synthetic events test app integration, not every OS input method. |
| 21 | `AUTO-21` / `AUTO_NAVIGATION` | Actual beforeunload and app-link dismissal preserve pending debounce; accepting navigation during held save prevents newer follow-up. Offline/conflict branches are above. |
| 23 | `AUTO-23` / `AUTO_TOKEN_PRECISION` | Real future `DATETIME(3)` token advances exactly +1 ms on each consecutive autosave. |
| 24 | Every case through guarded runner/global setup/hooks | Exact new run/commit/build, safe reporter protocol, finally discovery and exact-ID cleanup after PASS/FAIL. Only an actual guarded run can establish cleanup zero counts. |

AUTO-08, 09, 17, 20 and 22 are explicitly local-only in the spec; controller,
form/action/query/Flight tests supply their evidence. Browser tests do not claim
to prove inaccessible getters, Strict Mode lifecycle, server query ordering or
post-commit cache-failure behavior. Local harness mocks cover the AUTO-24 cleanup
control flow; they cannot certify real cleanup. This task changes no fixture
identity, mutation, provenance, cleanup, artifact-suppression or launch guard.

CMS-005 assertion changes are limited to the autosave business delta:

| Existing cases | Timing or assertion change | Preserved invariant / replacement |
|---|---|---|
| EDIT-08/09/12/14 | Pause browser clock after edit hydration before explicit saves. | All state, ownership, policy and millisecond-token assertions remain. AUTO cases separately exercise automatic dispatch. |
| EDIT-11 | Pause before actor mutation; require `FORBIDDEN` without redirect instead of accepting either redirect or error. | Denied write remains unchanged; draft/route retention is now additionally required. |
| EDIT-13 | Pause the shared context clock after both editors hydrate, then submit both manual actions. | Same concurrent real requests, exactly one winner, losing input retained. |
| EDIT-20 | Freeze debounce; switch context offline after the real POST dispatch, then continue it to a genuine network failure; expect paused autosave status. | Failed request, retained title/excerpt/body, no DB write, dirty navigation dismissal and successful explicit retry remain. AUTO-11 separately covers known-offline suppression. |
| All other CMS-005 cases | No scenario/assertion changes. Clock installation in the shared login helper keeps time running unless explicitly paused. | Native clipboard, formatting, create-first, route access, blank body and responsive assertions remain. |

The diagnostics registry has 36 exact title/file identities and **59 distinct
static step codes**: the original 44 plus 15 AUTO codes (the two admin cases share
`AUTO_ADMIN_SCOPE`). Autosave source locations allow only
`tests/e2e/cms-autosave.spec.ts`; helper-file and unknown locations stay null.
Two added synthetic diagnostics tests exercise all 16 new identities through both
reporter and runner filtering, reject cross-case/file/suffix/payload forgeries,
and preserve failed verdicts. There are 17 diagnostics unit cases; no raw action
body, DOM, cookie, clipboard, error message or response is emitted.

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

## Historical CMS-005 diagnostic checkpoint

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

Only `tests/e2e/cms-draft.spec.ts`, `tests/e2e/cms-editor-safety.spec.ts` and
`tests/e2e/cms-autosave.spec.ts`
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
exact CMS-006 commit**, followed by separately authorized Claude staging
QA. The previous commit's CI/staging results do not satisfy that gate. Keep the
existing trace/video/screenshot suppression, `preserveOutput: 'never'`,
`PLAYWRIGHT_NO_COPY_PROMPT=1`, one worker, zero retries, provenance, lock and fixture
guards. Do not run CMS-004 cleanup. See
[diagnostic implementation report](../docs/cms/reports/CMS-005-staging-diagnostics.md).
