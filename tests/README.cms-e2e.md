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
reporter emits only static case titles/statuses and summary counts. Login errors
are replaced with a role-only diagnostic; app/build diagnostics and Playwright
call logs are not forwarded. Never upload raw test-results, auth state, browser
traces, manifests, unreviewed screenshots or process environment dumps.

Attach only reviewed output containing commit/runId, case results and zero cleanup
counts. `CMS_E2E VERIFIED` is emitted only after browser success and verified
cleanup. Any `STOP`, failed case or nonzero remaining count means staging is not
PASS. Before the first real run, report **STAGING PENDING / browser NOT RUN**.
