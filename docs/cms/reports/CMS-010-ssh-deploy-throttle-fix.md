# CMS-010 deploy SSH throttle — local patch for Claude review

## Provenance and root cause

PR #25 has merged as `b1c822c9c0cd0095b40eee57ba91c253d98ac87b` (parents `5cbe3b8e0b456e701f7d9be820b94803546e98b4`, `de7a00e7b20fcbd8cf372595cb8b750994c9399a`). The tested head passed guarded staging run `7490f45a4e538bdd9020019c`, BUILD_ID `qd7pnlzrFgqtWb7hfFIpw`, 141/141 cases, VERIFIED, exit 0, and 19/19 cleanup counters zero. This is staging evidence supplied by PO/Claude, not a new run here.

GitHub deploy run [37601820204](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/37601820204), attempt 1, job `112727755395` built, assembled and packaged, then failed at `scp` with `kex_exchange_identification: read: Connection reset by peer`, `scp: Connection closed`, exit 255. The SSH identification failed before authentication/file transfer; the following remote APP replacement/restart command was not invoked in this run. The GitHub log also shows OpenSSH_8.7 keyscan banners, which do not by themselves identify the cause.

**Provider evidence supplied by the PO:** VinaHost attributed the connection closure for GitHub runner IP `4.242.196.139` during 07 Oct 2026 16:37:59–16:38:06 Vietnam time to `sshd MaxStartups` throttling. Codex did not read VinaHost server logs or reconnect to the host. The live BUILD_ID and CMS-010 installation remain unverified.

## Change and safety boundary

- `.github/workflows/deploy.yml` retains the build, assembly, package, secret-to-file setup and push-main trigger. Its SSH step invokes the new checked-in helper. The original remote APP replacement block is textually unchanged after indentation normalization.
- `scripts/cms-deploy/upload-and-activate.sh` requires key/archive files, runs bounded host-key scan, refuses an empty or failed scan, writes known_hosts and pauses **3 seconds** before upload. It uses strict host-key checking, the scanned known_hosts file, batch mode, `ConnectTimeout=15`, one connection attempt per command, and existing server-alive settings. No legacy host-key algorithm is enabled.
- Only archive `scp` is retryable: **3 attempts total**, pauses of **5 seconds** and **15 seconds** after attempts 1 and 2. Exhaustion returns the final `scp` exit code and never starts remote deployment. A retry can replace a partial archive at the fixed remote path; the remote command checks the complete tar before touching APP.
- The remote APP replacement/restart command is invoked **once after a successful upload**. Any nonzero result, including 255 or a lost response, returns its exit code, reports APP state unknown and stops. It is never retried automatically; exit 255 alone cannot prove the remote block was not run.
- `tests/deploy-ssh.test.mjs` runs the real Bash helper against isolated fake `ssh-keyscan`, `scp`, `ssh` and `sleep` commands. It checks ordering, retry count/delays, returned exit codes, argument quoting for paths with spaces, strict host-key/connection options, no remote invocation after failed upload, single remote invocation after success, and absence of the synthetic key marker from logs.

## Local validation

On Windows with Node `v24.19.0` and Git-Bash `5.3.15`, the focused mock-command suite passed **5/5**. Bash `-n` and Node `--check` passed. `js-yaml` already installed in the original workspace parsed the workflow and confirmed push-main/workflow_dispatch and helper invocation. ESLint from the existing workspace passed on the new test; it emitted only the expected React-version detection warning because the isolated worktree has no node_modules. `git diff --check` passed. The APP shell block in the helper was compared with the merge-SHA workflow and matched after indentation normalization.

The first local harness attempt missed the fake commands because Git-Bash did not prioritize a Windows PATH entry, and its synthetic `example.invalid` keyscan failed DNS. The harness now converts temporary paths to Git-Bash paths and prepends the fake bin inside Bash; the subsequent 5/5 run reached only fake commands. No production host was contacted.

These tests verify control flow, not GitHub-hosted runner connectivity or VinaHost behavior. No Actions deploy, SSH, staging or production operation ran for this patch. The bounded delay/retry does not guarantee MaxStartups will always clear; a future remote response loss still requires read-only host reconciliation rather than another automatic activation.

## Handoff inventory

| Path | Git-normalized blob before staging |
| --- | --- |
| `.github/workflows/deploy.yml` | `1ef4ca617a621a1c180d13c3b35eb54694289a1a` |
| `scripts/cms-deploy/upload-and-activate.sh` | `aec8de3adf56e3dd77297ecfc2afadc5aa7ec8ba` |
| `tests/deploy-ssh.test.mjs` | `95a70f9edd3375557426cad97883bfdc138502ea` |
| `docs/cms/reports/CMS-010-ssh-deploy-throttle-fix.md` | This report; its final blob is reported in the handoff, avoiding a self-referential hash. |

All four paths remain **UNSTAGED** in branch `fix/cms-010-deploy-ssh-throttle`, based on main `b1c822c9c0cd0095b40eee57ba91c253d98ac87b`, for Claude independent review. The original workspace's status-only `next.config.ts` was not modified or staged. Merging a later reviewed workflow PR into main will trigger the existing push-main deploy workflow; this checkpoint does **not** merge or start that deploy. CMS-010 remains merged but production release unverified. Manual authenticated production smoke/UAT remains DEFERRED to the end of the project.
