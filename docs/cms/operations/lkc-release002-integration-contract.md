# LKC_RELEASE_002 P5 — offline receipt and integration contracts

Status: **LOCAL_IMPLEMENTATION_CANDIDATE / CLAUDE2_REVIEW_REQUIRED**.
Base: `0f50a78df5fd4455586ca30bfcc7a8a4d5618ce6` (P1, PR #60).
Owner: Codex 2. Independent reviewer: Claude 2. No publication or execution grant.

P4 architecture PASS was supplied by PO/Integrator, with required correction
`DEPLOY-P4-BUG-001`: database **instance** isolation must be explicit. This candidate
adds that validation; only independent regression can close the finding.

## Boundary and prior art

- [P1 prototype](lkc-release002-activation.md) remains unchanged. Its archive/lock/journal
  functions are not called to activate anything by P5. The historical review status
  in that frozen document is superseded by the PO acceptance of P1, not edited here.
- Inspected [G1c JSON contract at PR #58](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/6e12eb9574c1741461252e599440eb520833e647/scripts/ci/trusted-evidence-json.mjs):
  `validateJsonBytes`, `parseJsonBytes`, `collectJsonBytes` enforce raw-byte grammar,
  duplicate keys, UTF-8 and limits before JSON deserialization. The G1c controller
  remains offline/advisory and is not a live issuer of deployment authority.
- P5 accepts **inert JavaScript data objects only**, not JSON text, bytes, callbacks,
  transport responses or credentials. It neither imports nor forks G1c's parser,
  signing/register implementation or shared trust policy. Object shape validation
  cannot detect duplicate keys already discarded by a previous JSON.parse. A future
  raw-byte ingress needs a separately approved shared contract/dependency; do not add
  a permissive JSON wrapper around P5.
- `snapshotData` copies only own enumerable data properties of ordinary/null-prototype
  objects and dense arrays. It rejects proxies before traps, getters/setters, magic
  prototype keys, symbols, custom prototypes, cycles, control characters and bounded
  size/depth/node excess. No getter, toJSON or caller function is invoked.

LKC-DUP-001 preflight: no five-path collision in 75 stored local/remote-tracking refs;
no physical collision in the inspected main/P1/G1c Codex 2 worktrees. Current open-PR
metadata included #58, #60 and separate CMS S1 #59/#61; none identified the P5 private
receipt validator. Stored refs and PR metadata do not prove absence in every clone.
Decision: **EXTEND** only the missing release-specific object/receipt binding. P1 and
G1c are prior art, not interchangeable authorization services. No CMS worktree/DB access.

## Public API and deterministic inputs

Source: [integration-contract.mjs](../../../scripts/cms-deploy/release002/integration-contract.mjs)
and [release-receipts.mjs](../../../scripts/cms-deploy/release002/release-receipts.mjs).

- `validateIntegrationContract(object)` returns structural success with a frozen copy,
  or a safe failure. It never returns an activation plan/capability.
- `fingerprintReceipt(object)` computes SHA-256 over a bounded canonical **object
  serialization** (sorted object keys, array order retained). It is an identity helper,
  not raw-byte integrity, signature verification or issuer authentication.
- `createOfflineReceiptValidator(configuration)` snapshots the separate bootstrap and
  returns `evaluate({receipts})`. Missing/invalid configuration fails closed. Requests
  cannot override configuration, clock, issuer, risk acceptance, epoch or expected target.
  No module accesses environment, clock, filesystem, network or external processes.

Bootstrap mode must be `OFFLINE_SYNTHETIC`, provenance `INDEPENDENT_SYNTHETIC_FIXTURE`.
Trusted CODE must construct it separately from receipt/request data. This separation is
an offline calling convention; a caller fabricating both inputs does not authenticate
an operator. The output is permanently non-operational even when all comparisons pass.

The expected contract binds repository numeric ID/full name, application source SHA,
artifact and manifest SHA-256, release ID, separate tooling source SHA, target/environment,
account, opaque database **and instance** fingerprints, operation/current/previous release,
MariaDB/Prisma/adapter versions, baseline and desired schema/history and ordered migration
inventory digest. A commit SHA is not an archive digest. Expected digests are supplied,
not calculated from a real database or artifact by P5.

Bootstrap additionally supplies a fixed evaluation time (positive integer Unix ms),
authority revision, independent minimum epoch, permitted issuer identities/roles,
exact five independently supplied receipt pins, revoked/consumed receipt IDs and consumed
operation IDs. Inputs are copied once; subsequent caller mutation cannot alter validation.
Recreate the evaluator with a fresh authorized snapshot for another observation. A frozen
clock is not a continuing freshness lease. Replay detection only compares supplied
history; no durable storage, cross-process consumption or policy authority is implemented.

## Receipt envelope and kinds

Every receipt has exact fields: `version`, `id`, `kind`, `issuerId`, `authorityRevision`,
`epoch`, `issuedAt`, `observedAt`, `expiresAt`, `revoked`, `provenance`, `binding`, `data`.
No unknown fields. Dates must satisfy observation <= issuance <= evaluation < expiry.
Issuer role, authority revision, independent epoch floor, exact pinned identity digest,
revocation, replay and complete candidate/target/operation binding all must match.
The fixture provenance is explicitly `CMS_OWNER_OR_OPERATOR_SYNTHETIC` with verification
`VERIFIED_SYNTHETIC` and an opaque evidence reference; this never means real CMS evidence.

Exactly one of each kind is required; duplicate IDs/kinds and partial sets fail:

| Kind | Required semantic evidence |
| --- | --- |
| S0_TARGET_METADATA | Actual-target identity binding, exact engine/tool versions, expected baseline schema/history, instanceIsolation. |
| S1_REHEARSAL | Desired schema/history/migration digests, matched versions, a separately identified DISPOSABLE database AND instance; legacy/FK/RESTRICT/mixed-version/partial-apply-recovery/restore fixture checks. |
| TARGET_DB_READY | Actual-target binding, desired schema/history/migrations, COMPLETE state, operation-bound exclusive unexpired writer lease, legacy/new-app/old-app-new-schema/old-app-new-data compatibility, instanceIsolation. |
| BACKUP_READY | Database/media/config/previous-app components, backup digest and identity, restore evidence reference/status, exact previous release. |
| RELEASE_AUTHORIZATION | OFFLINE_CONTRACT_EVALUATION purpose, previous release and exact pins for all four other receipts. It does not grant a release. |

Only CMS_DB_OWNER/DB_OPERATOR may be pinned for DB receipts; DB_OPERATOR for backup;
RELEASE_AUTHORITY for approval/risk acceptance. They are simulated identities, not a
new directory of real authorized people. A receipt cannot nominate its own trusted role.

All execution checks use `PASS_SYNTHETIC`; real PASS values are not accepted by this
offline interface. P5 does not turn S1 on a disposable database into target readiness.
PRODUCTION contract evaluation explicitly returns `PRODUCTION_OUT_OF_SCOPE`, including
when synthetic S1/target receipts appear complete.

## DEPLOY-P4-BUG-001 — mandatory instanceIsolation

Both S0_TARGET_METADATA and TARGET_DB_READY require the exact structure:

| Field | Validation |
| --- | --- |
| instanceFingerprint | Opaque SHA-256 server/instance identity matching the expected target. Database/schema name alone is insufficient. |
| databaseFingerprint, targetId, environment | Must bind to the same expected actual application target. |
| sharedWithProduction | Literal TRUE, FALSE or UNKNOWN. UNKNOWN always fails; boolean false or absent data is not FALSE. |
| provenance | Explicit evidence source, verification and opaque evidence reference; unverified/self-declared provenance fails. |
| observedAt, validUntil | Observation cannot postdate the receipt observation; must be valid at evaluation and not outlive receipt expiry. |
| limitations | Required bounded unique opaque limitation codes; never free-form sensitive infrastructure details. |
| resourceRisks | Required unique codes: CPU, MEMORY, IO, CONNECTIONS, ADMINISTRATION, BACKUP_RESTORE. |
| riskAcceptanceRef | Null only when no shared-production flag, limitations or resource risks exist; otherwise reference separately supplied acceptance. |

TRUE requires nonempty limitations and all six conservative risk categories. An
independently supplied acceptance must bind repository/candidate/operation/target/instance,
authority revision, RELEASE_AUTHORITY, DB_RESOURCE_SHARING scope and covered risks,
validity spanning the isolation observation's validity, non-revocation and evidence ref.
Receipt text or a request-supplied acceptance cannot satisfy it. The six-category
requirement is a conservative offline profile, not a claim that all infrastructure
risks are enumerated or that PO accepted them operationally.

FALSE with residual sharing risks or limitations still requires risk acceptance. FALSE
means a separately reported DB instance, not proof of separate hardware, account, host,
storage, backup or failure domain. Shared evidence is labeled
`SHARED_INSTANCE_ACCEPTED_SYNTHETIC`, never independent staging infrastructure.

S0/TARGET must agree on instance/database, sharing classification, limitations, risks
and acceptance reference. Independent observation timestamps/evidence IDs may differ;
each must remain valid. Conflict, missing structure, stale evidence, UNKNOWN or unverified
provenance fails closed even if a fixture issuer pinned the malformed receipt.

Codex 1/operator retain exclusive authority to produce actual database evidence. P5
does not issue receipts, verify MariaDB or accept infrastructure identifiers as discovery.
Tests use synthetic IDs/digests only; version numbers are fixture inputs, not target facts.

## Outcome and recovery boundary

All outputs have `status=NOT_VERIFIED`, `decision=HOLD`, `mode=OFFLINE_SYNTHETIC`,
`authorization=NONE`, `enforcement=NOT_AUTHORIZED`, `dbReady=false`. Permissions for
activate/retry/rollback/unlock/cleanup are all false. A positive case reports only
`scenarioValidation=PASS` / `OFFLINE_CONTRACTS_MATCH_ONLY`. It is not READY or an issuer ACK.

UNKNOWN_OUTCOME remains UNKNOWN_OUTCOME. Invalid/corrupt journal or RECOVERY_REQUIRED
halts evaluation. COMMITTED/ACKNOWLEDGED and previously consumed operations are replay
failures. Wrong current/previous release or selecting the current release again fails.
No automatic retry, rollback, unlock, cleanup or activation is suggested by any result.
Reports contain fixed safe codes and classifications, no raw receipt/payload/error data.

## Validation and review handoff

Tests: [contract/security tests](../../../tests/cms-release002-integration-contract.test.mjs)
and [receipt/isolation tests](../../../tests/cms-release002-release-receipts.test.mjs).
They exercise actual modules, pinned and deliberately re-pinned invalid semantic fixtures,
missing authority, request injection, stale/replayed/conflicting records, S1/target
distinction, shared-instance risk acceptance and hostile object boundaries. Import probes
block network, subprocess and filesystem-write APIs. Static import checks bound the
module dependency surface; they are not a general JavaScript security analyzer.

Actual runtime versions/counts/logs and five-file byte SHA-256/Git blobs belong in the
outside-Git handoff after execution; no previous candidate PASS is inherited here.
Claude 2 must independently review BUG-001 and trust/output boundaries before publication.

Not established: real issuer authentication, raw-byte ingress, durable floor/replay,
actual instance isolation, real S0/S1/DB_READY, host identity/locking/durability, backup
restore, cPanel activation, workflows, staging or production readiness. Neither source
tests nor a syntactically valid receipt close those gates. Manual production UAT remains
DEFERRED. PR #60 and G1c source remain frozen.

**P5_LOCAL_IMPLEMENTATION_GO / CLAUDE2_REVIEW_REQUIRED / LIVE_INTEGRATION_HOLD /
S2_HOLD / PRODUCTION_NO_GO**
