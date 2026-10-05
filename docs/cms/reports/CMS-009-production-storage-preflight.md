# CMS-009 — production private storage preflight

Checkpoint: branch `feature/cms-009-media-library`, HEAD `12cc768b1316d0af992a69a6e77f6a556e724d26`, PR #24 directly rechecked OPEN/DRAFT against `main` with the same head. CI run `37193200652` passed 857/857. Product Owner supplied guarded staging evidence: operator initiated, Claude monitored/verified run `0eef9d35cac6974f60d87472`, BUILD_ID `b7rCcIw1R9peW_MGUugbL`, 122/122 browser cases and all 19 cleanup counters zero, `CMS_E2E VERIFIED`, exit 0. These are prior gates, not rerun by Codex here. Historic FAIL checkpoints remain historic. CMS-009 is not deployed or COMPLETE; manual authenticated production UAT remains DEFERRED.

## What was actually done

- Read `AGENTS.md`, installed Next deploying/self-hosting guides, CMS-009 spec/handoff, [storage contract](../operations/cms009-media-storage.md), deploy workflow, media storage/HTTP implementation, standalone assembly and smoke scripts. No product source, dependency, workflow, schema, or test expectation was changed.
- Read-only SSH with strict host-key checking and the previously approved key reached only the named project host/account. Host FQDN matched `vdc-whm-cheaphosting-1112.vinahost.org`. No key contents, `.env`, full process environment, or unrelated website was read. The first broad `PassengerApps` JSON query was blocked by automatic review because it could contain environment secrets; the replacement query filtered fields **on the host** before output. No secret-bearing JSON was returned to the workspace.
- Prepared [operator runbook](../operations/cms009-production-storage-release.md), a fail-closed [storage CLI](../../../scripts/cms-media/production-storage-preflight.mjs), and [safety tests](../../../tests/cms-media-production-storage-preflight.test.mjs). No production write command was executed. The CLI itself is unstaged and is not in release head; operator use requires its own review and verified package digest.

## Read-only production observations

| Item | Evidence observed | Interpretation |
|---|---|---|
| Account and binding | SSH account `edpmjmha`; domain data gives `/home/edpmjmha/public_html`; its `.htaccess` sets PassengerAppRoot `/home/edpmjmha/lkcfintech.com.vn/deploy`, base `/`, startup `server.js`, configured Node `/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node`. | Target APP/document root and Passenger binding VERIFIED. SSH account is **not** proof of Passenger service UID/GID. |
| Paths | APP, APP/public, APP/.next, document root exist and realpath to themselves. APP and APP/public/.next are owned UID 2789/GID 2794; document root UID 2789/GID 65534. Home is UID 2789/GID 2794, mode 0711. | App path and purge zone VERIFIED. Do not infer a safe private root from ownership alone. |
| Node | Configured Passenger binary executes `v22.18.0`; `/opt/alt/alt-nodejs22/root/usr/bin/node` also executes `v22.18.0`. | Configured binary VERIFIED; actual active worker process/binary and service identity NOT VERIFIED. This is not CI's Node 22.23.2. |
| App manager and env | `uapi PassengerApps list_applications` status 1, zero listed applications. Exact document-root `.htaccess` has no `CMS_MEDIA_ROOT` name. Target-user process scan by exact APP cwd saw zero matching process before/after one anonymous homepage HEAD 200. | Active env management and runtime `CMS_MEDIA_ROOT` are UNKNOWN. Empty UAPI list/cwd scan do not prove the app is absent or env unset. Do not equate SSH shell env with Passenger env. |
| Proposed root | `/home/edpmjmha/private` and `/home/edpmjmha/private/cms-media` both returned ENOENT. | This remains an **example candidate**, not an existing/provisioned root. It is outside the confirmed APP and document root by path, but all aliases/realpaths must be approved before provision. |
| Capacity | `uapi Quota get_quota_info`: status 1, 24,576 MB account limit, 3,085.61 MB used, 21,490.39 MB remaining, under overall quota. `df -Pk` on APP mount: 1,081,797,824 1-KiB blocks available, 72% used; `df -Pi`: 329,050,242 inodes available. UAPI inode limit reports 0 with `under_inode_limit=1`. | Point-in-time capacity VERIFIED. Whether inode limit 0 denotes unlimited, media allocation, alerting, and future growth are NOT VERIFIED. |
| Request body | No `LimitRequestBody`, `RequestReadTimeout`, or `client_max_body_size` text in exact document-root `.htaccess`. | Effective Apache/proxy/Passenger request cap NOT VERIFIED; config elsewhere may apply. Application stream cap is 5,242,880 bytes by source. |
| Backup | `uapi Backup list_backups` returned status 1 and empty array. | Provider/other backup mechanisms and consistent DB+files+journal restore are NOT VERIFIED; empty UAPI list is not proof no backup exists. |

The read-only SSH survey did not touch DB, media data, fixtures, cleanup, production env, ACL, proxy, or Passenger restart. One compound survey command ended with a harmless here-document parsing error after its filtered quota/path outputs; those outputs are used only as observations, not a PASS of an operational probe. No sentinel or candidate bundle was executed on the host.

## Release gates

| Gate | State now | Evidence and next concrete action |
|---|---|---|
| Reviewed head, CI, guarded browser staging | VERIFIED | Exact head above; prior CI and PO-supplied Claude staging evidence. |
| Private root outside all webroots and deploy purge | BLOCKED | Proposed root absent. Operator/provider must approve exact path and check all domain aliases/docroots and realpaths. Deploy workflow's purge set is known. |
| Service UID/GID, marker, permissions, exact sentinel FS operations | BLOCKED | SSH/file owner numbers are observed, but Passenger service identity is unknown. After confirmation, separately authorized operator runs reviewed CLI `provision`, `inspect`, and `probe` under that identity. No existing data is adopted. |
| `CMS_MEDIA_ROOT` in actual Passenger runtime | NOT VERIFIED | `.htaccess` lacks its name; UAPI app list empty. Identify host control plane, configure server-only env after separate authorization, verify at runtime after deploy. |
| Linux/cPanel candidate bundle worker/codecs | NOT VERIFIED | CI build and Windows staging do not prove host runtime. Exact-head candidate source **and** assembled bundle are needed because existing smoke reads traced files and a test child from the checkout. Run isolated with Passenger Node, sanitized dummy env, no traffic. |
| Proxy/body cap | NOT VERIFIED | Provider/control-plane evidence must show raw body >= 5 MiB accepted while app remains capped at 5 MiB. No server-global config change made. |
| Quota and backup/restore | PARTIAL / NOT VERIFIED | Quota snapshot observed; reserve/alerts and coordinated DB + `objects` + `operations` + root marker backup, isolated restore drill remain. UAPI backup list alone is insufficient. |
| Persistence and app smoke across first deploy | POST-DEPLOY PENDING | `retain` SHA-256 sentinel before deploy, `verify` after deploy, then exact `remove`; confirm actual Passenger env, worker/codecs, authenticated synthetic behavior. This is **not** a prerequisite already executable before the first deploy. |
| Rollback/restore | PLAN ONLY | Separate authorization required; no rollback or restore performed. |

## Prepared approach and safety properties

The CLI accepts explicit `--home`, `--app`, `--webroot`, `--root`, expected UID/GID and root identity; production writes require Linux real/effective UID/GID equality plus exact confirmation. It refuses root overlap with deploy/webroot and refuses a symlinked or unknown existing root. Provision creates only a new root and four folders, 0700 directories and a 0600 marker with version 1/purpose/32-hex identity. It does not recursively alter ownership or permissions. A partial failure is left for manual review. The synthetic probe checks exclusive create → write/fsync → rename/read → hardlink/read → exact unlink. The persistence sentinel has an external SHA-256 to verify across deploy and is removed only by exact ID/hash/identity. No command reads a DB or starts the application.

The [runbook](../operations/cms009-production-storage-release.md) distinguishes the pre-merge infrastructure/candidate checks from post-deploy runtime/persistence and a separately authorized rollback. It explicitly requires a reviewed CLI artifact outside the released source head; the CLI's presence in this working tree is not proof it exists on the host. Production storage preparation remains an operational release gate, not a CMS implementation change.

## Local validation and limits

New files: `scripts/cms-media/production-storage-preflight.mjs`, `tests/cms-media-production-storage-preflight.test.mjs`, `docs/cms/operations/cms009-production-storage-release.md`, this report. Sanitized child environment with dummy `DATABASE_URL`/`NEXTAUTH_URL`: local Node **24.19.0** `--check` PASS, focused tests **2/2 PASS** (0 fail/skip), scoped ESLint PASS. `git diff --check` and `git diff --cached --check` PASS; explicit untracked-file whitespace/conflict-marker/final-newline scan PASS for all four new files. The Windows local tests validate path containment and fail-closed command guards with synthetic paths; the Linux filesystem write path was **NOT RUN** locally or on production. Node 24 local validation is not a substitute for the configured cPanel Node 22.18.0 candidate smoke. Full 857 tests, TypeScript/build, CI, staging, and production smoke were not rerun for this operational documentation/tool delta.

No staging/production DB, SSH write, fixture, cleanup, migration, env edit, ACL change, proxy edit, service restart, commit, push, PR update, ready, merge, or deploy occurred. `next.config.ts` retains its preexisting status-only `M`; `git diff` is empty and Git-normalized blob equals HEAD (`4d0d963d45e57b949a3add6a600832ce14efbce6`). Index remains empty. The new files stay UNSTAGED for Claude independent review.

## Handoff to operator and Claude

Claude should review CLI path/owner/mode/marker checks, exact sentinel cleanup and failure paths, shell blocks, actual standalone smoke dependencies, and the distinction between observed host state and plans. Operator/provider then needs to identify Passenger service identity and env control plane, approve the private root, arrange reviewed tool/candidate artifact provenance, confirm body limit and coordinated backup/restore, and execute separately authorized pre-merge storage gates. This report does not claim that CMS-009 is release-ready.

## Delta after Claude independent review — 2026-10-05 (UTC+7)

Product Owner supplied Claude's independent review of all four preflight files: no blocking source finding. The LOW finding concerned **coverage**, not a reproduced CLI defect: the original test file had two passing checks but did not execute the Linux provision/probe/retain/verify/remove branches. This delta changes only `tests/cms-media-production-storage-preflight.test.mjs` and this report. The CLI and operator runbook remain unchanged.

The test file now registers **10** cases under `node:test`: two cross-platform checks, one explicit non-Linux rejection check, and **seven explicit Linux-only cases**. `package.json` runs `node --test tests/*.test.mjs`; `.github/workflows/ci.yml` invokes that script on Ubuntu with Node 22, so the existing CI glob will discover the new file without workflow changes. The Linux cases execute the real CLI as child processes with an allowlisted synthetic environment, real process UID/GID, and a fresh temporary tree containing synthetic APP, webroot, and media root. They do not consume inherited `CMS_MEDIA_ROOT`, DB credentials, or production paths. Test cleanup targets only the tree returned by its own `mkdtemp` after confirming it remains a directory.

| Coverage added for Linux | Observable assertions, beyond exit status |
|---|---|
| Provision and probe | Marker version/purpose/identity, 0700 directories/0600 marker, exact layout, successful CLI filesystem probe including its hardlink stage, and content/mode/owner snapshot unchanged with empty `tmp`/`objects` afterward. |
| Wrong UID/GID | Each mismatch is rejected before provision; full synthetic tree snapshot stays unchanged. |
| Existing and foreign-populated root | Existing root with foreign bytes rejects provision; an unknown root entry rejects probe; bytes/layout are preserved. |
| Symlink and identity drift | Symlinked `tmp`, wrong expected root identity, and altered marker identity reject probe/inspect without modifying target or marker bytes. |
| Persistence sentinel | Retain produces an actual file with recorded ID/hash; verify accepts it; wrong hash refuses removal; correct exact removal restores baseline snapshot. Tampered content and wrong root identity refuse verify/remove and preserve the altered sentinel. |

**Validation actually run:** local Windows, prepared Node `v22.23.2`, with dummy `DATABASE_URL`/`NEXTAUTH_URL` in a filtered child environment: syntax checks for CLI and test PASS; focused test file **3 passed / 0 failed / 7 skipped / 0 cancelled**; scoped ESLint PASS. `git diff --check` and `git diff --cached --check` PASS; all four untracked files pass whitespace/conflict-marker/final-newline scan. The seven skips are deliberately visible because they require Linux. Windows Subsystem for Linux is not installed and no local Docker executable was available; no Linux filesystem test was run locally. The previous Node 24.19.0 preflight 2/2 result is historical and does not cover these new cases.

**Pending evidence:** after this delta is reviewed and committed by a separately authorized task, the existing Ubuntu/Node 22 CI must execute the seven Linux cases and report their real result. Until then, Linux provision/probe/persistence and the exact cPanel Node 22.18.0 filesystem remain **NOT VERIFIED**. No CI was dispatched in this turn. Service identity, runtime `CMS_MEDIA_ROOT`, approved private root, proxy/body cap, coordinated backup/restore, candidate bundle smoke, and post-deploy persistence remain at the gate states above. Staging 122/122 PASS and its prior FAIL history are unchanged; manual authenticated production UAT remains DEFERRED, and CMS-009 is not COMPLETE.

Final local Git checkpoint: HEAD `12cc768b1316d0af992a69a6e77f6a556e724d26`, branch `feature/cms-009-media-library`, four preflight paths untracked/UNSTAGED and index empty. Of those four, this delta changes the test and report content only. `next.config.ts` remains status-only `M` with no content diff and Git-normalized blob matching HEAD; it was not reset, staged, or edited.
