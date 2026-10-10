# LKC Engineering & Security — PO Decisions and Rollout Ledger

**Version:** v1.0-DRAFT · **Purpose:** A place for the Product Owner to add requirements, decisions, target risk tolerance, domain approvers and milestones, without rewriting previously reviewed code.
**Current state:** **PROPOSED**, not merged into `main`, not permission to deploy or migrate a real DB.

Task SEC-BASE-001 is authorized to prepare this four-file proposal from G0 `424ff4b85e99a38d888e31c0dedbff28bceb7987`, branch `docs/lkc-esqs-security-framework`, planned Draft PR base `docs/ai-delivery-governance`. Independent reviewer: Claude 2, **NOT_REVIEWED** at this handoff. This is not approval of the OPEN decisions below or a change to any schema/consumer slot. [G0 operating model](AI-DELIVERY-OPERATING-MODEL.md) remains the process authority; [standards](ENGINEERING-SECURITY-STANDARDS.md), [register](SECURITY-CONTROLS-REGISTER.md) and [DUP runbook](LKC-DUP-001-RUNBOOK.md) extend it with proposed control/evidence tracking.

## 1. PO input / change form (copy a block for each decision)

```yaml
decision_id: "LKC-DEC-YYYY-NNN"
domain: "CMS | Portal | Product | Billing | MarketData | Quant | Governance"
topic: "Describe the capability, risk or rule to add/modify"
requested_behavior: "Observable outcome"
reason: "Business/customer/regulatory/security motivation"
affected_control_ids: ["LKC-SEC-003"]
affected_task_ids: []
classification: "A | B | C | B+C"
affected_owners: ["Codex 1", "Codex 2", "PO", "security reviewer TBD"]
acceptance_criteria:
  - "Positive case ..."
  - "Unauthorized/negative case ..."
existing_evidence: ["PR or source SHA, if applicable"]
status: "PROPOSED"
approver: "TBD — human identity/role"
decided_at: ""
expiry_if_exception: ""
notes: ""
```

**Rules for amendments:** assign a stable ID; record why and who approved; compare affected source/contracts/tests; do not silently change a rule on which another lane depends. A task already meeting the new requirement can be marked REUSE with evidence rather than reimplemented.

## 2. High-impact decisions awaiting PO / designated human approval

| Decision ID | Question to fill in | Current status | Proposed accountable role | Affected gate |
|---|---|---|---|---|
| `PO-SEC-01` | Is public GitHub visibility **intentional**, considering proprietary quant strategies, datasets and third-party market-data licenses? | **OPEN** (repo observed public) | PO + IP/data owner | SEC-005 / DATA-001 / MKT-001 |
| `PO-SEC-02` | Who is the named human GitHub admin/release approver and **CODEOWNER**? Which accounts can bypass branch protection? | **OPEN / NOT_VERIFIED** | PO + GitHub admin | OWN-001 / REL-001 |
| `PO-SEC-03` | Which required reviews, security checks and approvals should protect `main`? | **OPEN / NOT_VERIFIED** | GitHub admin + PO | REL-001 |
| `PO-SEC-04` | Which person/security function owns triage of Critical/High vulnerabilities and security incidents? | **OPEN** | PO + security owner | SEC-005 / OPS-001 / GOV-001 |
| `PO-SEC-05` | Approve or revise the proposed ASVS v5.0.0 Level 2 target, selected Level 3 requirements, applicability and evidence criteria for each operation. | **OPEN / PROPOSED_TARGET** | PO + designated security reviewer | ARCH-001 / SEC-001..006 / TEST-001..003 |
| `PO-DATA-01` | What is the target MariaDB version/edition, compatibility matrix and approved disposable test environment? | **OPEN / TARGET_VERSION_NOT_VERIFIED** | DB operator + PO | DATA-002 / CMS-001 |
| `PO-DATA-02` | What RTO, RPO, retention, backup/restore schedule and destruction policy applies to CMS/Portal/customer data? | **OPEN** | Operations + data protection owner | DATA-001 / OPS-001 |
| `PO-PAY-01` | Which payment provider/processes handle card data and refunds; who decides entitlements, grace periods and commercial policy? | **OPEN** | PO + Billing/domain owner + legal | PAY-001 / SEC-003 |
| `PO-MKT-01` | What are the data-provider usage and redistribution rights? Which indicator/backtest probability disclosures are required? | **OPEN** | PO + Quant/data + legal | MKT-001 |
| `PO-AUTH-01` | Confirm five QA role-account profiles, MFA/step-up scope and sensitive administrator operations. | **OPEN** | Security owner + PO | SEC-001/002/003 |
| `PO-OPS-01` | Who can authorize staging browser destructive tests, production UAT and releases; who owns rollback/incident response? | **OPEN** | PO + Ops | REL-001 / OPS-001 |

**Add rows freely.** Use explicit `DECIDED` + date/evidence when resolved. Do not put credentials or private customer data in this ledger.

No named human role is assigned by this draft. Existing semantic ACKs and authorized lane work remain valid within scope; new commercial defaults, retirement/resubmit rules, self-approval/TAKE policy, retained historical labels, C02/C06 readiness and release decisions remain OPEN. A valid Product entitlement covers all three recommendation groups, without a tab paywall; publication/audience/content checks remain applicable. The historical C01/C02 document LOW L1/L2 remain OPEN; this proposal does not close them or reopen CLOSED source findings.

## 3. Priority roadmap — parallel execution without artificial waiting

| Wave / task | Owner → reviewer | Source/output scope | Prerequisite (real only) | Completion evidence |
|---|---|---|---|---|
| **Now — LKC-DUP-001** | Both Codex lanes → corresponding Claude | Apply preflight in each task's ordinary handoff/PR; no extra register PR | Existing G0 working rules | AC comparison / prior art / action included on new tasks |
| **G1a — Stacked PR CI** | Codex 2 → Claude 2 | Only `.github/workflows/ci.yml`; reviewed separate PR | Verify workflow scope/ownership; main deploy risk | Draft PR, reviewer PASS, true source/checkout evidence; **activation not implied** |
| **S0 — SEC-BASE-001** | Codex 2 → Claude 2 | Exactly four proposed Markdown docs; stack from G0 reviewed head while G0 is unmerged | G0 PR #45 reference and exact docs-path preflight | Four docs, 26 unique control IDs, matching independent review, Draft PR and actual CI status; no source/CI changes |
| **S1a — Repo protection review** | Human GitHub admin + PO | Inspect effective rulesets, actors, mandatory checks, secret security, repo visibility | Admin access and authorization | Screenshot/config export or trusted settings evidence; protection VERIFIED or gaps logged |
| **S1b — Security operations files** | Authorized single writer → independent reviewer | CODEOWNERS (real user/team), SECURITY.md, Dependabot update PRs | S1a owner identities and access decisions | Reviewed scope, PR/CI, verified human CODEOWNERS identity |
| **G1b — Evidence & duplicate metadata** | Codex 2 → Claude 2 | Script/tests/workflow separate from G1a; no semantic-oracle claims | Reviewed G1a and documented PR evidence template | Positive/negative fixtures; no false positives on stacked ancestry |
| **S2 — Application threat model** | Solution architect + both lane owners; security reviewer | Article Publish, paid reader, Billing/Entitlements, MarketData/Quant DFDs and API trust boundaries | Current contracts and applicable PO decisions | Explicit threats/mitigations/open risks and AC/ASVS coverage |
| **S3 — Security test hardening** | Both lanes + independent Claude | Own code/tests only; isolated DB/staging testers by permission | Target DB/environment, QA identities and test lease | Cross-role/tenant/premium leakage, race/rollback, fault injection, CodeQL/SCA/SBOM proof |
| **G2 — Agent review automation pilot** | Integrator + security/repo admin | One opt-in Draft PR, read-only source + review comments (no auto-merge) | G0, G1a/b and token security review | No feedback loop, no secret access, reviewer revision integrity, human authorization |
| **Release / production UAT** | Human authorized release owner | Approved release bundle, DB migration plan, staging smoke, rollback | All applicable controls/evidence | Release approval, exact deployed SHA, observed outcome, production UAT result |

**Standing rule:** G1a, S0 and lane-private CMS/Product source work may proceed independently in separate worktrees when no shared-file collision exists. Claude 1 never needs to wait for Claude 2 to review a CMS-only task. Shared schema/Audience Physical still uses effective one-writer handoff.

These are planned waves, not blanket permission to create future files, change settings, install scanning tools or send review comments. Each future task has its own exact scope/authority and evidence. G1b is separate from G1a. Read-only settings review and human identity decisions precede authorized settings changes; absence of configuration files alone proves no settings state.

## 4. Definition of Done at each level

- `DOCS_REVIEWED`: authoritative owner, exact files and relevant references, Claude PASS, Draft PR. **Not production effective** until authorized integration.
- `SOURCE_CI_PASS`: immutable source commit/reviewer verdict + matching CI run, actual checkout SHA, test results and no blocking source findings. **Not runtime activation**.
- `DB_PROOF_PASS`: separately authorized disposable test DB matching target version, FK/index/rollback/partial recovery/concurrency results tied to schema SHA.
- `STAGING_PASS`: approved staging data/fixture lease with role QA, negative cases, cleanup graph, captured run and rollback evidence.
- `RELEASE_READY`: all applicable controls pass, effective branch protections and human decision. Not a substitute for domain/legal signoff.

**CMS/Product DB gate:** Current CMS-011.1 proof status is `CMS-011.1_DB_PROOF_BLOCKED_BY_ENVIRONMENT`, not compatibility PASS or migration failure. Target MariaDB version/metadata is NOT_VERIFIED; DDL apply, legacy/mixed-version, composite FK/RESTRICT and partial-apply recovery are NOT_RUN (CMS owner supplied, PO relayed). Static inventory of 33 DDL statements is an owner report, not execution proof. To unblock: verify target metadata through an approved channel; prepare an isolated disposable instance matching that version; pin schema/migration and Prisma/adapter versions; execute the compatibility/concurrency/recovery matrix; record exact engine/version, commands, outcomes and recovery evidence. A required foundation change returns to Integrator for ordered scope/handoff; CMS and Product do not edit schema concurrently. Authoring a migration grants no right to apply it to a real DB, staging or production.

At this checkpoint Product Codex 2 still holds the published schema slot. Audience Physical remains a separate draft dependent on the Product test compatibility commit/review; SEC grants or releases neither slot. Unmerged Product/CMS branches are not presumed combined on main.

## 5. Release decision record (fill only by authorized human)

```yaml
release_id: ""
product_or_module: ""
source_commit_sha: ""
verified_CI_run_URL_and_checkout_sha: ""
reviewers_and_status: []
database_migration_proof: "NOT_RUN"
staging_browser_proof: "NOT_RUN"
security_findings_open: []
exceptions_and_expiry: []
rollout_strategy: ""
backout_or_restore_plan: ""
monitoring_and_responder: ""
authorized_by: "NOT_GRANTED"
authorized_at: ""
actual_deployed_sha: "NOT_DEPLOYED"
production_UAT: "DEFERRED"
```

**Explicit prohibition:** G0 or SEC-BASE docs PASS, AI review PASS and ordinary CI green must never silently turn into permission to merge `main`, deploy, execute migrations or publish paid/trading content.

## 6. SEC-BASE-001 review contract

Outcome: four reviewable proposal documents that reuse G0, define exactly 26 controls and let each function record actual evidence and unresolved decisions. Risk **B**, shared governance; PO assigned this exact CREATE scope to Codex 2, reviewer Claude 2. Exact paths and completed preflight are in [runbook §9](LKC-DUP-001-RUNBOOK.md#9-sec-base-001-preflight-actually-performed--2026-10-10). G0 instructions, G1a, registry, source/tests, schema/migrations, package/lock and deployment are forbidden changes for this delta.

| AC | Required document check / review mapping |
|---|---|
| SEC-AC-01 | Compare package/G0/registry/prior source and branches/worktrees; declare checked scope and reuse/extend result without claiming universal absence. |
| SEC-AC-02 | Catalogue and register each contain the same 26 unique control IDs; every register row has a full MUST requirement, accountable owner, independent reviewer, gate and control-specific evidence/action. |
| SEC-AC-03 | A autonomy, full B boundaries, C execution gates, PO precedence and effective claims agree with G0/registry; no lane waits on unrelated controls. |
| SEC-AC-04 | Check version/status against official references; pin editions where available and distinguish draft/living guidance from stable/final; no external certification claim. |
| SEC-AC-05 | No control VERIFIED/PASS from docs or mocks; direct inspection, author evidence, PO-relayed Claude/CMS reports and OPEN/TBD decisions remain distinct. |
| SEC-AC-06 | Internal relative file/anchor links resolve; official external references support their associated edition/status. |
| SEC-AC-07 | Exactly four CREATE paths, strict UTF-8/no BOM, no whitespace/conflict issues including untracked files, empty index, G0/G1a and other worktree checkpoints preserved. |
| SEC-AC-08 | Handoff branch/base/HEAD and separate byte SHA-256 / Git-normalized blobs for the exact four files UNSTAGED; independent Claude review precedes commit/push/Draft PR into G0. Record actual CI status after publication, without substituting G0 CI for SEC CI. |

These mappings are checks to perform, not test PASS declarations. Local document checks and independent Claude verdict are separate evidence. If no matching CI starts for the dependency-base Draft PR, report NOT_RUN/NOT_STARTED and use only an authorized `ci.yml` validate dispatch when available; no alternate candidate/deploy run, empty commit or trigger change. No dependency on G1a completion is introduced. Manual authenticated production UAT remains **DEFERRED**.
