# LKC Engineering, Security & Quality Standard (LKC-ESQS)

> **Version:** v1.0 — `PROPOSED / NOT_EFFECTIVE` · **Created:** 2026-10-10 · **Owner of policy:** PO / Solution Architect · **Implementation:** Codex 1 + Claude 1 (CMS), Codex 2 + Claude 2 (Portal/Product).
> This is an **internal standard proposal**, **not** an ASVS, ISO 27001, SOC 2, PCI DSS or SLSA certification. Do not mark a control PASS without evidence matching the tested source revision and affected operation.
>
> **How to amend:** Add a decision row to [PO-DECISIONS-AND-ROLLOUT.md](PO-DECISIONS-AND-ROLLOUT.md), identify exact affected control IDs, make a scoped Draft PR, obtain independent review, and await authorized integration. Do not rewrite historical evidence or change existing control semantics silently. SEC-BASE-001 authorizes preparing/reviewing this proposal; it does not decide every OPEN policy or grant release authority.

## 1. Authority, references and scope

| Standard / official source | Version/status verified on 2026-10-10 | Intended LKC use |
|---|---|---|
| [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) | **1.1 final**; [SSDF 1.2 (SP 800-218 Rev.1)](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd) is a **draft** | Secure development across Prepare Organization, Protect Software, Produce Well-Secured Software, Respond to Vulnerabilities |
| [OWASP ASVS](https://owasp.org/projects/asvs) | **5.0.0 latest stable**; pin [release tag v5.0.0_release](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release), not master or the GitHub `latest` bleeding-edge preview | Proposed target: Level 2 overall, selected Level 3 requirements by threat model; exact scope and human approval remain OPEN (`PO-SEC-05`) |
| [OWASP API Security Top 10](https://api-security.owasp.org/editions/2023/en/0x11-t10/) | **2023 edition** | BOLA/BFLA, property-level authorization, authentication, resource usage, SSRF and unsafe API consumption |
| [OWASP SAMM](https://owaspsamm.org/model/) | v2 model; five functions, fifteen practices | Maturity self-assessment; does not certify product security |
| [Microsoft SDL](https://learn.microsoft.com/en-us/compliance/assurance/assurance-microsoft-security-development-lifecycle) | Living guidance, checked on the date above; no numbered edition claimed | Requirements, threat model, secure implementation, verification, release, response |
| [Google Engineering Practices](https://google.github.io/eng-practices/review/) | Living code-review guidance, checked on the date above | Independent code review, correctness, design simplicity, maintainability |
| [OpenSSF SLSA](https://slsa.dev/spec/v1.2/) | **v1.2 approved/current**; [v1.1](https://slsa.dev/spec/v1.1/) is retired | Source/build tracks, provenance, artifact integrity; **no level claimed** |
| [OpenSSF OSPS Baseline](https://baseline.openssf.org/versions/2026-08-28) | **v2026.08.28**; [current-version index](https://baseline.openssf.org/) checked on the date above; designed for open-source projects | Adapt selected hygiene controls with documented applicability; do not adopt every open-source licensing/distribution requirement or claim OSPS compliance by analogy |
| [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use) | Living platform guidance, checked on the date above | Least privilege, trusted checkout, dependency/action pinning, protected branches |

**Data and legal boundaries:** Determine applicable law, payment provider/scope (including whether PCI DSS applies), financial recommendation obligations, market-data licensing, personal-data processing and incident reporting with qualified advisors. Do not infer those obligations from a code review alone.

## 2. Mandatory semantics and existing governance

- **MUST** = proposed LKC internal obligation for applicable operations once adopted; **SHOULD** = recommendation with a recorded reason if deferred; **MAY** = optional. These are internal policy terms, not external-standard quotations or evidence of implementation. Existing PO/G0 instructions already apply independently of this draft. Applicability and any exception MUST be recorded; an unresolved business/security decision remains OPEN.
- **A — Lane-private:** Codex 1 has standing ownership of internal CMS files, including `src/features/cms/article-*` and ArticleDraftForm; Codex 2 owns private Portal/Product files. Only when no B boundary, cross-lane consumer interface or overlapping claim/local work applies, the lane completes implementation → tests → its independent Claude review → fix/regression → Draft PR → CI without a registry slot per task. Standing ownership still permits only one writer per file; absence of a remote PR is not proof of no local work.
- **B — Shared/single-writer:** `prisma/schema.prisma`, migrations, shared contracts/composition, auth/roles/authz and shared auth/onboarding, `src/components/portal/PortalShell.tsx`, global/layout/brand components, media storage/store/routes/cleanup, workflows, package/lock, shared instructions, active overlapping claims and cross-lane consumer interfaces require exactly one authorized writer and explicit scope/dependency/handoff. A lane namespace alone does not make these paths A.
- **C — High risk:** production merge/deploy, real DB apply, Payment/Billing/Entitlements, authorization/sensitive data, trading-recommendation publication and unresolved material business policy keep separate execution/release or decision gates. Teams prepare authorized code/tests/evidence autonomously; existing authorization persists. Do not request new approval for each already-authorized A fix or infer release permission from source review. Shared C work also follows B.
- Reuse the [AI Delivery Operating Model](AI-DELIVERY-OPERATING-MODEL.md) at [G0 source 424ff4b8](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/424ff4b85e99a38d888e31c0dedbff28bceb7987/docs/lkc-platform/AI-DELIVERY-OPERATING-MODEL.md), [PR #45](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/45), and [registry §2 at 3d724205](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/3d7242059115aa9220ad01c4cadfc0d680c4d1b4/docs/lkc-platform/COORDINATION.md). G0 replaces per-task slots only for A; shared B boundaries remain until formally amended. Effective claims/handoffs are not revoked by ESQS. Another lane's active claim requires Integrator collision resolution before editing. G0 remains OPEN/DRAFT, unmerged at this checkpoint; its historical local-status text does not describe its current publication state.
- **Reviewer independence:** Claude has read/test permission and may create isolated probes; in `REVIEW_ONLY` mode it MUST NOT modify source/tests, stage, commit, push, approve its own changes or perform merges. Codex MUST NOT self-report Claude PASS.
- **Human approval:** an AI-reviewed Draft PR is **not** authorization to merge, deploy, apply a real migration or activate customer-facing financial functionality.

## 3. Gate rules

The G0–G5 labels below name **control gates**, not delivery task IDs such as governance G0 or CI G1a. They do not reopen completed task reviews. Apply only the gates relevant to the operation and record why others are N/A. Missing release/DB evidence blocks that activation, while independent authoring/review continues.

| Gate | A: independent | B: shared | C: high risk |
|---|---|---|---|
| **G0: START** | LKC-DUP-001 preflight; owner; AC; exact paths; source base and dirty status | Above + single-writer releasing/receiving owner and contract/dependency | Above + threat model, abuse scenarios, identified domain approver and open risk |
| **G1: DESIGN** | Contract and negative test cases appropriate to change | API/data boundary review; backward compatibility; migration ordering | Sensitive-data/data-flow diagram, threat controls and rollback strategy |
| **G2: REVIEW** | Claude independently checks actual diff/behavior/AC | Above + consumer compatibility and dependency SHA | Above + qualified human domain/security review when applicable |
| **G3: PR/CI** | Draft PR, actual revision + CI run, lint/types/unit/build as applicable | Above + integration/contracts and stacked ancestry | Above + SAST/SCA/secrets and attack/abuse scenarios relevant to operation |
| **G4: DB/STAGING** | N/A for pure work, otherwise scoped integration proof | Target-specific DB/API contract proof where needed | Disposable matching MariaDB, concurrency/rollback, staged role QA/Playwright, recovery, security test evidence |
| **G5: RELEASE** | NO autonomous main merge | NO autonomous main merge | Explicit human authorization, all applicable gates, monitored deployment and rollback plan |

**Blocking policy:** Critical/High exploitable vulnerabilities, secret exposures, auth bypass, premium-content leak, dangerous data corruption, materially failed required CI, missing required DB proof and missing human release authorization **block the affected high-risk activation/release**, not all unrelated private-lane development. Exceptions use `LKC-GOV-001` and cannot re-label FAIL as PASS.

## 4. Control catalogue (26 internal IDs)

The working evidence/status/owner for **each ID** lives in [SECURITY-CONTROLS-REGISTER.md](SECURITY-CONTROLS-REGISTER.md). Each row below is an intended **MUST** requirement for its applicable scope; recommendations use SHOULD explicitly. Terms such as "implemented" or "verified" must be scoped to a source SHA and concrete evidence. The register assigns implementation responsibility separately from independent review.

| ID | Non-negotiable behavior / minimum control |
|---|---|
| **LKC-DUP-001** | Check prior implementations by **behavior and AC**, not just filenames or Task IDs. Reuse or extend proven work; do not duplicate authoritative modules or PRs. |
| **LKC-OWN-001** | Check repo/worktree/dirty index/base SHA, exact paths, current owners and claims before changes. One writer per shared file. |
| **LKC-ARCH-001** | Record trusted sources, data-flow boundaries, versioned shared contracts and threat model/ADR for shared or high-risk design. |
| **LKC-ARCH-002** | Do not create competing authoritative Product, entitlement, immutable published-version or market-data sources; use approved ports. |
| **LKC-SEC-001** | Recheck authentication/authorization server-side for every action, object ID, property, actor scope and state; deny by default (BOLA/BFLA). |
| **LKC-SEC-002** | Secure session/cookies/CSRF/account recovery; fresh role/status validation and MFA/step-up for sensitive actions as determined by threat model. |
| **LKC-SEC-003** | No premium content in SSR/HTML/RSC, browser cache, prefetch, public media or API without a current server-side entitlement decision; UNKNOWN/NULL fails closed. |
| **LKC-SEC-004** | Strict input boundaries, encoding, parameterized queries, SSRF/XSS/path/upload protections, bounded execution and errors. |
| **LKC-SEC-005** | Do not expose secrets/credentials/PII in repo, logs, client bundles or CI; use least-privilege tokens, reviewed rotation, TLS in transit and appropriate encryption at rest. |
| **LKC-SEC-006** | Safe error schemas and security audit trails with actor/object/version/outcome; no sensitive exception/DB/file diagnostics or editable false history. |
| **LKC-DATA-001** | Maintain data classification, access/retention/deletion matrix, segregated dev/staging/prod, synthetic fixtures and approved backups. |
| **LKC-DATA-002** | Expand-compatible migrations, FK/index/onDelete, legacy and mixed-version plan, rollback/recovery; test against correct disposable target MariaDB before applying. |
| **LKC-CMS-001** | Working Article differs from immutable ArticleVersion; CAS/version-bound Submit/Approve/Publish, idempotency/lost-ACK rules and safe approval invalidation. |
| **LKC-CMS-002** | Current and historical media references block destructive deletion; validate lock order, receipts, unlink journal, FK retention and authorization separately. |
| **LKC-PAY-001** | Payment/entitlement is server-authoritative; verify event signatures, idempotency, replay/out-of-order/refund/expire/revoke and do not trust success redirects. |
| **LKC-MKT-001** | Market data and quant indicators carry provider/license, event & ingest time, staleness, model/backtest version and reproducibility; no unsourced win rates/probabilities. |
| **LKC-TEST-001** | Map AC → positive/negative/boundary test → SHA; mocks do not constitute database, staging or runtime proof. |
| **LKC-TEST-002** | Use layered unit, API/integration, target-DB, Playwright role staging, DAST/pentest according to risk; distinguish PASS, FAIL, SKIP and NOT_RUN. |
| **LKC-TEST-003** | Verify races, stale CAS, retries, loss-of-ACK, duplicate/out-of-order events, rollback, resource caps and fault injection on transaction-sensitive flows. |
| **LKC-SUP-001** | Dependency lockfile, deterministic `npm ci`, vulnerability triage, vetted full-SHA action pinning and appropriate SBOM/build provenance objective. |
| **LKC-CI-001** | Tie every CI verdict to head SHA, actual checkout SHA, synthetic merge/base parents when applicable, run attempt, Node version, test counts and URL. |
| **LKC-CI-002** | Least-privilege Actions; never run untrusted PR code with production secrets; no privilege-elevated `pull_request_target` checkout. |
| **LKC-REL-001** | Protect `main` via authenticated reviewers and checks; no AI auto-merge or admin bypass; human release authority, staged validation and rollback. |
| **LKC-OPS-001** | Assign incident owner, monitor/alert, test backup restoration and set RTO/RPO, patch/vulnerability response and recovery playbooks. |
| **LKC-AI-001** | Separate code author/reviewer, resist untrusted agent instructions/prompt injection, preserve hashes, do not invent test/approval evidence. |
| **LKC-GOV-001** | Risk exceptions require recorded owner, scope, compensating control, independent approver, expiry and remediation; cannot manufacture compliance. |

## 5. Mandatory security and testing requirements by domain

| Domain | Critical positive and negative evidence before applicable runtime launch |
|---|---|
| **CMS + media** | Correct actor/author/version and role drift; CAS, double Submit and lost ACK; historical media references; immutable ArticleVersion; DRAFT is not published; lock/concurrency/partial recovery on MariaDB. |
| **Paid Portal** | Anonymous and other-account denial; PAID vs PUBLIC vs NULL; no body in RSC/HTML/prefetch/cache before entitlement; expiry, refund, Product retirement, revoked access, 5 QA role matrix; no object/property-level leakage. |
| **Product + Billing** | Stable Product identity under rename/retirement, `saleStopped` independently modeled; webhook signature/idempotency/replay/out-of-order, provider outage/chargeback/refund; no entitlement based only on UI. |
| **Market Data + Quant** | Provider license and data lineage; event/ingest time, timezone, stale/gap/out-of-order handling, reproducible replay/backtest, prevention of look-ahead/survivorship leakage, calibrated probability and model revision disclosure. |
| **Auth/API** | Cross-user & cross-tenant BOLA/BFLA, mass assignment, CSRF/session fixation, input/XSS/SSRF, rate/resource limits, safe exceptions, audit and incident alerting. |
| **CI/Release** | Secret exposure, PR metadata injection, untrusted workflow checkout, dependencies/actions provenance, correct revision, protected main, backup restore and safe rollback. |

**Product access boundary:** Keep five Products × three recommendation groups (manual, external-system automatic, forecast/probability). One valid Product entitlement covers all three groups of that Product; capabilities MUST NOT create a separate paywall per tab. Publication, audience and per-content authorization checks still apply. This does not implement C02, webhooks, forecasting or trading. Product `saleStopped` remains independent from retirement/selectability; retained resubmit/approve policy stays OPEN, with no PUBLIC fallback or silent removal of IDs.

**CMS/C01 integration boundary:** Semantic ACK of C01/C02 is not shared-contract publication, DB proof or runtime READY. Submit/Approve Product validation must use the mutation's same transaction client and keep the required locks/revalidation through CAS/version/event commit or rollback. A catalog fingerprint does not replace Article CAS or atomicity. Retained lookup's current name is not a historical version label and grants no resubmit/approve permission. Prisma 7 root-client rejection/transaction binding follows the published [erratum PR #43](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/43); no nested transaction. These obligations do not grant a writer/runtime slot.

## 6. Evidence levels — never conflate them

`PROPOSED` = requirement only. `DOCUMENTED_DRAFT` = policy described in unmerged PR. `IMPLEMENTED_UNVERIFIED` = code exists without matching proof. `REVIEWED_SCOPE` = independently reviewed exact revision (does not prove runtime). `CI_PASS_SCOPE` = matching source SHA CI success. `DB_PROOF_PASS_SCOPE` / `STAGING_PASS_SCOPE` = target-specific evidence. `RELEASE_APPROVED` = authorized decision. `NOT_VERIFIED`, `NOT_RUN` and `BLOCKED` are distinct and **never inferred as PASS**.

A PR may have multiple different statuses at the same time: e.g. `CI_PASS_SCOPE + DB_NOT_RUN + RUNTIME_NOT_ACTIVATED + MERGE_PENDING`.

## 7. Current source checkpoints (2026-10-10; verify live at execution)

- **Integrator read directly:** [G0 PR #45](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/45) is OPEN/DRAFT, unmerged, head `424ff4b85e99a38d888e31c0dedbff28bceb7987`; [CI run 38027475848](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/38027475848) attempt 1, event `pull_request`, SUCCESS on that source. Checkout evidence from the G0 publication checkpoint is synthetic merge `4ad909cb6e9a71bf7efe1b0ff2711d4651133be6`, not the source head. **PO supplied:** Claude 2 G0_REGRESSION_PASS / G0-B1 CLOSED. Neither fact verifies all ESQS controls.
- **Integrator direct remote inspection:** [G1a Draft PR #46](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/46) is published at source `640c4dfedaf26a242df09209bc9e843b792804df`, parent `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`; Claude G1a_REVIEW_PASS was supplied by PO. [CI run 38035918646](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/38035918646) SUCCESS, attempt 1, event pull_request, actual synthetic merge checkout `84b36c390d4660332433a42f472f34447425bb17`. The PR remains OPEN/DRAFT and unmerged; repository-wide stacked-PR activation is NOT_VERIFIED pending approved integration. SEC does not change the workflow or certify repository-wide activation.
- **G0 source inspection:** push to main triggers `.github/workflows/deploy.yml`, including documentation merges. No autonomous merge. `CODEOWNERS`, `.github/CODEOWNERS`, `SECURITY.md`, `.github/SECURITY.md` and `.github/dependabot.yml` are absent at the G0 tree; this is a path-presence finding, not proof corresponding GitHub settings are off.
- **Prior G0 access result:** protection API returned 403; rulesets list was empty in that check. Effective protection/bypass actors remain NOT_VERIFIED; the historical result is not a fresh admin audit.
- Product A/B, CMS M0/Q0 and Audience Physical retain their separate source, CI, DB and activation gates. [M0 PR #44](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/44) head `0c1188ebd69438f10004a78e54ad5be742dd610d` has [validate run 38014409217](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/38014409217) attempt 1, `workflow_dispatch`, SUCCESS (Integrator read metadata directly); that is pure-plan source evidence, not media deletion/retention DB proof. CMS owner/PO reports target-version and DB proof BLOCKED_BY_ENVIRONMENT, execution NOT_RUN; Integrator did not inspect the CMS machine or run DB tests.
- **Integrator read repository metadata directly:** visibility is PUBLIC. Compatibility with proprietary strategy/model/research and market-data licenses remains OPEN (`PO-SEC-01`); no visibility/settings changes are authorized here.

## 8. Update and audit cadence

- At every **new task**: Codex executes [LKC-DUP-001-RUNBOOK.md](LKC-DUP-001-RUNBOOK.md) and OWN-001, then works autonomously within authority.
- At every **Draft PR**: Claude reviews source revision, Codex records SHA/CI/AC/control IDs; no AI auto-merge.
- At **each high-risk milestone**: update the register with real evidence and explicit reviewer/human decision.
- **Monthly (proposed cadence, execution NOT_RUN)**: owners SHOULD review unresolved Critical/High findings, security dependency alerts, stale controls and risk exception expiry.
- **Quarterly (proposed cadence, execution NOT_RUN)**: PO/architect/security lead SHOULD review threat models, SAMM maturity and recovery/response exercise evidence.
- On **incident, architecture change or material legal/regulatory change**: reassess relevant controls immediately; do not wait for cadence.

See [PO-DECISIONS-AND-ROLLOUT.md](PO-DECISIONS-AND-ROLLOUT.md) for customizable policy decisions and an implementation plan. The review of this document does not by itself authorize production deployment or certify compliance.
