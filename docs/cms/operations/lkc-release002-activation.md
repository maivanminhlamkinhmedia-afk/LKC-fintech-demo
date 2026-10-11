# LKC_RELEASE_002 P1 — offline activation candidate

Owner: Codex 2. Independent reviewer: Claude 2, **SOURCE_REVIEW_PENDING**.
PO supplied R0 independent review PASS; that acceptance does not cover this implementation.
Production readiness: **NO-GO**. No SSH, cPanel, database, workflow, application start or live deployment.

## Scope and provenance

- Branch: `feature/release002-safe-activation`.
- Worktree: `E:/LKC-Portal/worktrees/release002-safe-activation`.
- HEAD/base: `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`; no implementation commit created.
- CREATE only: the four modules below, one focused test and this document. Keep UNSTAGED for review.
- LKC-DUP-001: six paths absent at baseline and in 71 locally stored heads/remote-tracking refs;
  dedicated destination absent before worktree creation. GitHub open-PR search for `release002`
  returned no matches. This is not proof of absence in every clone or unpublished claim.
- Existing upload/activation and CMS media recovery were assessed at R0. Neither provides this
  offline release identity/journal model; neither is changed or invoked by P1 tests.
- Codex 1 retains S0 environment, schema/migration inventory and DB readiness ownership.

## Exact files and API

| File | Responsibility |
|---|---|
| [archive-integrity.mjs](../../../scripts/cms-deploy/release002/archive-integrity.mjs) | `verifyArchive(bytes, approved)` checks SHA-256, bounded gzip, restricted ustar, exact manifest and file hashes before any extraction. |
| [activation-plan.mjs](../../../scripts/cms-deploy/release002/activation-plan.mjs) | `createActivationPlan` snapshots trusted synthetic approval; binds target, operation, owner, release/source/hash, prior receipt, account/path and host-key policy. `classifyRecovery` makes no mutations. |
| [release-journal.mjs](../../../scripts/cms-deploy/release002/release-journal.mjs) | Fresh marked sandbox, target guards, journal append/fsync, hash chain, independent head file and strict replay validation. |
| [fake-target.mjs](../../../scripts/cms-deploy/release002/fake-target.mjs) | Creates/reopens a synthetic target; upload, prepare, locked simulated directory activation and read-only recovery inspection. |
| [cms-release002-activation.test.mjs](../../../tests/cms-release002-activation.test.mjs) | Independent fixture encoder and positive/negative tests against the actual modules; no mirror implementation or real SSH. |
| This document | State machine, policy, evidence limits and Claude handoff. |

All modules are import-safe and have no live CLI entrypoint. They import only Node core and
these local modules; no dependencies, workflow or configuration changes are needed.

## Artifact and archive contract

An approved fixture supplies `releaseId`, exact 40-hex `sourceSha`, archive SHA-256 and an exact
file manifest of path/size/SHA-256. The normalized receipt's SHA-256 pins the prior release.
Approval is protected in an in-memory plan handle; plain objects, later caller mutations and
untrusted metadata accessors cannot replace it. This is **synthetic bootstrap**, not authenticated
GitHub build provenance. A hash proves bytes, not authorization or freshness by itself.

The uploaded bytes must match the pinned archive digest and every approved file. A valid old
gzip/tar at the expected upload location fails when it differs from the candidate pin; tar
readability alone is never sufficient. Reusing the current release ID is rejected. Operation IDs
are not reusable in journal history. There is no production release-order authority or signed
manifest verification in this slice; approval of the correct candidate remains an external gate.

The offline profile accepts regular-file POSIX ustar headers only. It rejects links, directories,
PAX/GNU extensions, devices, absolute/traversal/backslash paths, duplicate/case collisions,
file/parent collisions, Windows reserved names, `.env*`, unsafe modes, bad checksums/padding,
missing end blocks and files outside the exact manifest. Directories are synthesized privately.
Limits: 4 MiB compressed, 8 MiB expanded, 64 files, 1 MiB/file. These are mock limits, not a
production Next.js archive format or capacity decision. A real archive will need separately
reviewed format/size/dependency-closure support; no compatibility is implied here.

Upload and activation must name the same synthetic path:
`/home/<mock-user>/releases/<releaseId>/archive.tar.gz`. These strings are never used for actual
remote I/O. The fake upload is a new operation-specific file under the marked target. Inconsistent
SSH user, old hardcoded archive path or another release's path is rejected before activation.

## Fake target and activation state machine

The sandbox must be a fresh absolute `lkc-release002-mock-*` directory with a fixed offline marker.
Creation refuses existing roots; target operations check markers and real directory ancestors.
Fixture files and child processes stay inside that root. No recursive cleanup is provided.

Each target holds `uploads/`, complete `current/`, optional `prepared/` and retained `previous/`.
Release trees contain a normalized receipt and `files/`; actual membership, sizes and digests
are verified. An existing previous tree or abandoned preparation is never overwritten.

Normal journal progression:

```text
LOCKED -> PREPARING -> PREPARED -> ACTIVATING -> COMMITTED -> ACKNOWLEDGED
```

1. Read and hash a bounded copy of the uploaded candidate before extraction or live-tree changes.
2. Acquire `activation.lock` using exclusive mkdir; write owner/operation/nonce/fence and fsync.
3. Verify prior release and absence of existing previous/prepared; journal LOCKED/PREPARING.
4. Extract validated bytes into a new prepared tree, fsync files, verify full inventory; PREPARED.
5. Recheck ownership and both complete trees; persist ACTIVATING before switching.
6. Rename current to previous, then prepared to current. These are **two operations**, not one
   atomic switch. This fake target serves no traffic and starts no process.
7. Verify current and previous; persist COMMITTED. Only after acknowledged simulated completion,
   verify again, persist ACKNOWLEDGED and remove the exact owned lock files/directory.

Preparation faults produce RECOVERY_REQUIRED and retain evidence/lock. Once activation may
have started, faults produce UNKNOWN_OUTCOME. In particular, loss of ACK after COMMITTED returns
UNKNOWN_OUTCOME, not success. The journal records UNKNOWN_OUTCOME when it can safely do so;
a failed journal write is never repaired automatically and does not change that outward result.

Read-only `inspectRecovery` reopens target/journal evidence and verifies receipts/trees. It may
report ACTIVATED_OBSERVED only with matching COMMITTED evidence and complete current/previous;
NOT_ACTIVATED_OBSERVED means the pinned prior tree remains intact before activation. Corruption,
partial switch or unproved commit yields RECOVERY_REQUIRED. These observations concern only
the synthetic filesystem. They never release locks, retry, switch bundles, authorize rollback
or change the original UNKNOWN response. There is no recovery execution API in P1.

## Lock, fencing and journal guarantees

- One disk mkdir lock shared by cooperating handles/processes; no process-local-only lock.
- Token binds target, operation, owner, nonce and fence. Fence is the next journal sequence at
  acquisition; subsequent records and phase transitions must retain that binding.
- Owner token is rechecked after every asynchronous fault hook and before critical writes;
  journal append also checks owner/fence. No TTL/PID takeover or automatic stale-lock stealing.
- Journal NDJSON records have contiguous sequence, previous hash, plan/receipt bindings, strict
  transition order and SHA-256. Canonical re-encoding rejects duplicate keys/extra fields.
- Each append fsyncs the file, then writes/fsyncs an exclusive next-head file, renames it and
  attempts directory fsync. Missing/mismatched head, torn tail, orphan next-head and corruption
  fail closed. A crash between append and head publication deliberately requires reconciliation.
- This is a cooperative offline model, not an authenticated ledger or distributed lock service.
  Coordinated rollback of both journal and head, a malicious same-UID process, arbitrary direct
  filesystem writes, mount swaps and hostile concurrent symlink races are not solved here.
- File fsync and directory-sync attempts do not prove storage-controller or power-loss durability.
  Unsupported directory sync is explicitly NOT_VERIFIED on Windows. cPanel/Linux filesystem,
  rename/lock semantics, ownership/ACLs and durable fencing require isolated host evidence.

Node documents fsync as a request to the operating system; device/OS semantics matter.
[Node 22 file-system reference](https://nodejs.org/docs/latest-v22.x/api/fs.html#filehandlesync).
No atomicity, rollback or production recoverability claim follows from mock PASS.

## Verified-host-key policy (specification, no transport)

`checkHostKeyPolicy` requires a synthetic `.invalid` host, SHA-256 pin, independent-operator
source label and verifier identity. Runtime keyscan, TOFU and PR-body sources are denied.
Even an accepted fixture returns `liveHostVerified=false`, SYNTHETIC_POLICY_ONLY.
No key or credential is provisioned and no handshake is performed.

Future integration MUST obtain an authenticated protected pin binding host, port, algorithm,
fingerprint and rotation/version approval through an independent operator/provider channel.
The SSH transport must compare the actual host key to that pin and stop on missing/drifted
identity. A self-declared label or same-channel keyscan is not that evidence. No automatic key
replacement is allowed. This future trusted channel and transport need a separate reviewed slot.
[OpenSSH keyscan security caveat](https://man.openbsd.org/ssh-keyscan.1).

## Mock test matrix and validation

All results are **author-executed synthetic tests**, not Claude execution, GitHub CI or host proof.
The actual commands/results and full byte/Git fingerprints are handed off separately so this
file does not attempt a self-referential fingerprint.

| IDs | Assertions against actual implementation |
|---|---|
| P1-01 | Successful synthetic activation, exact previous bundle and reopened journal. |
| P1-02/03/04 | Missing/mismatched digest, valid stale archive, account/path/release mismatch. |
| P1-05/06/07 | Traversal/links/extensions, checksum/digest/membership, caps and hostile metadata. |
| P1-08/09 | Faults before/during preparation and both non-atomic switch steps; evidence retained. |
| P1-10 | Lost ACK after commit remains UNKNOWN; read-only resolution, no blind retry. |
| P1-11/11b/12 | Concurrent handles and separate process; owner/fence tampering denies stale writer. |
| P1-13/14/15 | Torn/corrupted journal, independent head mismatch, incomplete current/previous/prepared. |
| P1-16/17/18/19 | Plan snapshot, pin-source denial, marked target, lock ownership and import safety. |
| P1-20 | Hash-correct malicious tar rejected by target before any lock or preparation writes. |

Run the focused suite with Node 22 or 24:

```text
node --test --test-reporter=tap tests/cms-release002-activation.test.mjs
```

The test creates one fresh marked mock sandbox under the OS test-temp parent by default.
For reproducible evidence, set `LKC_RELEASE002_MOCK_ROOT` to an unused absolute path with the
required basename. All fixtures remain inside that synthetic target; no live path is accepted.
Never point it at an existing directory. Tests deliberately retain evidence for inspection.
Source syntax and scoped ESLint are applicable. TypeScript does not validate these MJS modules;
application build, Prisma and database execution provide no mock durability proof.

## Claude 2 review handoff and remaining gates

Review all six created files read-only at the handed-off fingerprints; independently execute
the focused tests in a fresh marked synthetic root. Check the tar parser's rejection profile,
stale-archive proof, owner/fence transitions, interrupted journal and UNKNOWN_OUTCOME behavior.
Add adversarial probes within reviewer-owned mock targets. Do not edit source or reuse author
targets. Return P1_SOURCE_REVIEW_PASS/FAIL tied to exact hashes and independently run evidence.

OPEN: independent source review; Linux/process-crash/power-loss/host atomicity proof; actual
artifact signing/provenance and release authority; production-format packaging; isolated target
identity/service manager; real host pin custody; S0 MariaDB compatibility; backup/restore and
app/DB/media consistency; scoped staging transport/activation and browser/UAT authorization.
R0 PASS and P1 mock PASS satisfy none of those execution gates. No workflow integration,
publication, database or production authority is included; Codex 1 S0 is uninterrupted.

Final boundary: **LOCAL_IMPLEMENTATION_GO / LIVE_DEPLOY_INTEGRATION_HOLD / S2_HOLD / PRODUCTION_NO_GO**.
