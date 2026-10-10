# LKC-DUP-001 — Already Implemented Check

**Draft internal work instruction** · **Task type:** Preflight applied to A, B and C tasks · **Owner:** the Codex receiving the task · **Independent verification:** the Claude reviewer checks this preflight during ordinary source review.

**Purpose:** Before creating or changing code/docs, determine whether the **required behavior** already exists, exists partially, has only been reviewed, or has evidence of actual activation. Save time without confusing stacked PRs or reviewing inaccessible work. Use the existing [G0 operating model](AI-DELIVERY-OPERATING-MODEL.md) task contract; the [ESQS standard](ENGINEERING-SECURITY-STANDARDS.md) and [control register](SECURITY-CONTROLS-REGISTER.md) add scoped evidence tracking.

## 1. No extra approval loop

- Codex performs this check **in the same task execution**. For A (lane-private) do not create a special registry PR or ask ChatGPT just to say “not duplicate.”
- For B shared, check active claims and handoff with Integrator before changing protected shared files. A lane namespace alone does not make shared files A. For C, prepare already-authorized code/tests and preserve separate execution/release or unresolved-policy approval; do not request another approval for each authorized lane-private security fix.
- Claude does not automatically PASS a duplicate decision. It verifies the evidence against the actual task behavior and checked source revision.

## 2. Eight-step preflight

1. **Normalize demand** — Task ID, intended observable outcome, positive/negative AC, action/resource/audience, owner, risk A/B/C, exact proposed paths, base commit and consumer contract.
2. **Read existing implementation** at target source base (which may differ from `main`), `main`, relevant open/draft PR heads, integration branches, schema/migrations, API routes, tests, docs and logs. Search by synonyms, model/field names, relevant symbols **and behavior**.
3. **Check physical workspace** — repo root, origin, worktree branch, HEAD, dirty/staged/untracked and exact path collisions. Only assert local worktree facts about machines and clones actually inspected.
4. **Identify prior art** — for every plausible match record PR URL, commit SHA, touched file paths, exported symbols/interfaces, author, reviewer, status, CI and dependency ancestry. A PR whose diff inherits another PR is not automatically a second independent implementation.
5. **Map AC to evidence** — AC → behavior/source → verified commit/blobs → review → test → runtime evidence. A pure contract or mock test cannot count as deployed behavior. If a source is inaccessible mark `NOT_VERIFIED`, not `NOT_STARTED`.
6. **Decide status** — one state (`NOT_STARTED`, `PARTIAL`, `IMPLEMENTED_UNREVIEWED`, `REVIEWED`, `CI_PASS`, `BLOCKED`) plus independent gates (`DB_NOT_RUN`, `RUNTIME_NOT_ACTIVATED`, `MERGE_PENDING`, `UNVERIFIED_SCOPE`).
7. **Decide action** — `REUSE`, `EXTEND`, `CONTINUE_REVIEW`, `CONTINUE_CI`, `NEW_TASK` or `ESCALATE_BOUNDARY`; include concrete reason. `REUSE` is allowed only when the existing behavior meets **all applicable AC**, not just because similarly named files exist.
8. **Execute idempotently** — if a reviewed implementation/branch/PR exists, continue from the correct checkpoint without creating new commits/PRs, rewriting source, or overwriting dirty work. Escalate only conflict, missing policy or shared ownership; continue unaffected independent tasks.

## 3. Safe read-only inspection examples

Use the tools available in the particular Codex environment; **GitHub connector and `gh` may not both be available**. These commands are illustrative and must be adjusted to a verified repo root:

```bash
# Local identity and dirty/untracked paths — read only
git rev-parse --show-toplevel
git remote -v
git rev-parse HEAD
git branch --show-current
git status --porcelain=v1 -uall
git worktree list

# Histories / touched files / keyword investigation — read only
git log --all --oneline --grep='CMS-011.2\|AUDPHY\|Product' -i
git branch -a
git grep -n -i 'ArticleVersionMedia\|ArticleProduct\|getSelectableProducts' HEAD -- src prisma tests

# If ripgrep exists, search local UNTRACKED files as well; inspect findings in context
rg -n 'ArticleVersionMedia|ArticleProduct|getSelectableProducts' src prisma tests docs

# GitHub CLI only when it exists and is authenticated (otherwise use connector/API)
gh pr list --repo maivanminhlamkinhmedia-afk/LKC-fintech-demo --state open --limit 100
```

**Caution:** `git grep HEAD` checks tracked material at the requested commit, not untracked source. Local inspection does not cover other machines. Avoid `git reset`, `git clean`, force push, stash or branch switching to perform this preflight.

## 4. Decision table

| Status | Evidence situation | Action |
|---|---|---|
| `NOT_STARTED` | No semantic match found **within a fully declared checked scope** | `NEW_TASK`; do not claim universal absence |
| `PARTIAL` | Some AC implemented, others missing | `EXTEND` only missing ACs |
| `IMPLEMENTED_UNREVIEWED` | Source exists, no independent match to actual revision | `CONTINUE_REVIEW` with same owner/reviewer |
| `REVIEWED` | Claude PASS on inspected source, but CI absent or incomplete | `CONTINUE_CI` (and publication if necessary) |
| `CI_PASS` | CI success on correct source SHA; may still be unmerged/unactivated | `REUSE` for code already satisfying AC, preserve separate runtime gates |
| `BLOCKED` | Real ownership clash, missing domain decision, broken dependencies, or release gate | `ESCALATE_BOUNDARY`; do not stop unrelated A work |

## 5. Mandatory negative controls

- **Same file across stacked PRs** is not proof of accidental duplication; check parent ancestry and merge provenance.
- **Same behavior under different names** may still duplicate an authoritative Product catalog, subscription authority or published reader; flag for architecture review.
- **Mock/pure policy PASS** ≠ DB lock proof, live webhook, published reader or activated entitlement.
- **Open Draft PR** ≠ code in main or deployed production.
- **Old CI run** on a previous commit ≠ CI success for the current change.
- **Missing access** to another Windows worktree ≠ no work exists; say `NOT_VERIFIED` and cite the limitation.
- **Incomplete AC** means existing implementation can be reused only for satisfied subcases.

## 6. Required output (copy into task handoff and PR)

```yaml
LKC-DUP-001:
  task_id: "CMS-011.2-M1"
  checked_at: "YYYY-MM-DDTHH:MM:SS+07:00"
  repository: "maivanminhlamkinhmedia-afk/LKC-fintech-demo"
  source_base_sha: "FULL_SHA"
  checked_scope:
    - "base commit and source"
    - "main"
    - "relevant open/draft PRs & branch ancestry"
    - "tests, routes, schema/migrations"
    - "local worktrees and untracked paths on this machine"
  inaccessible_scope: ["other agent machine, if not directly checked"]
  prior_art:
    - "PR number | source SHA | file | what behavior is proven"
  ac_evidence:
    M1_01: "NOT_VERIFIED or exact source/test"
    M1_02: "PARTIAL or exact source/test"
  status: "PARTIAL"
  flags: ["DB_NOT_RUN", "RUNTIME_NOT_ACTIVATED"]
  action: "EXTEND"
  owner: "Codex 1"
  reviewer: "Claude 1"
  rationale: "Only the missing historical media reference guard is new; preserve current cover guard"
```

If no prior art is found: write **“No matching implementation found in the checked scope”**, never “No implementation exists anywhere.”

## 7. Reviewer checklist (during normal Claude code review)

- [ ] Evidence scope and SHA matches the Codex report.
- [ ] Source/PR matches have been inspected semantically, not only filename grep.
- [ ] AC coverage versus claimed status is accurate; open runtime gates are preserved.
- [ ] Overlap is distinguished from intentional stacking/integration.
- [ ] New files do not duplicate authoritative models/ports/routes.
- [ ] No unsafe Git operations or foreign worktree mutation was used to inspect.
- [ ] Review result records any DUP decision issue as a finding in **the same review**, not a separate review queue.

## 8. Maintenance and automation boundary

- **Now:** Codex + Claude apply this procedure manually per task.
- **G1b later:** CI can verify Task ID, required evidence fields, duplicate PR number/head, exact path lists and evident collisions. CI **cannot prove semantic equivalence** or full absence of duplicate behavior; a human/agent reviewer still makes the domain judgment.
- **Never:** use false-positive file-overlap alerts to block an intentionally stacked PR without examining ancestry.

## 9. SEC-BASE-001 preflight actually performed — 2026-10-10

**Actor/provenance:** Codex 2 / Integrator inspected the Portal clone/worktrees and GitHub metadata directly. CMS-machine worktree/DB facts cited in companion docs came from CMS owner or PO; no direct CMS-machine inspection is claimed. This record is a preflight result, not Claude review, control certification or runtime evidence.

| Check / source | Actual result and reuse decision |
|---|---|
| Workspace / origin | `E:\LKC-Portal`, Git root `E:\LKC-Portal\LKC-fintech-demo`; origin `https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo.git`. Main worktree clean. |
| Exact source / remote baseline | `origin/main` = `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`; G0 branch `docs/ai-delivery-governance` = `424ff4b85e99a38d888e31c0dedbff28bceb7987`, [PR #45](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/45) OPEN/DRAFT, unmerged. No baseline substitution or docs merge. |
| Package, outside repository | Read README and all four docs in `E:\ELKC-Portal\LKC-ESQS-control-framework-v1.0.zip`; SHA-256 bytes `4f7ffeac802eb2dbd74b1e701dfec8f303e1be48cf3640f111b273da3ec561a7`. Four unpacked copies matched ZIP-entry bytes. ZIP/README remain outside the repo. ChatGPT-prepared input is not approved code or a review verdict. |
| Existing process equivalent | Read G0 instructions/model, [registry §2/claims at 3d724205](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/3d7242059115aa9220ad01c4cadfc0d680c4d1b4/docs/lkc-platform/COORDINATION.md) and baseline platform docs at `bd903b784976eb0a147844cac72fd7295a79c00b`. G0 already covers A/B/C, task contracts, independent review, publication and release gates. **REUSE** this process through links; do not create a competing governance authority. |
| Semantic/source comparison | Inspected main/G0 auth/authz/roles, CMS/media/source/test/workflow inventory and relevant unmerged Product/CMS contract/schema/producer checkpoints. Existing source tests and operational reports are evidence only for their own operations/revisions; they are not a 26-control engineering/security ledger or compliance certification. Search terms included ESQS, SEC-BASE, security controls, standards and duplicate/preflight equivalents, plus exact titles/IDs. |
| Branch/PR scope | Initial local inventory covered 50 heads/remote-tracking refs. Final check at `2026-10-10T07:01:45.799Z` covered **53 stored refs and 36 live remote heads**, including the new SEC branch with no docs yet. Fetched only the missing Q0/M0 refs to inspect their trees. Exact four paths absent in every checked tree. Inspected metadata for **19 OPEN PRs (#27–#45)**; no equivalent ESQS proposal identified in that scope. Metadata absence is not a claim about unseen private work. |
| Physical overlap | Inspected **17 existing local worktrees**, then the new SEC worktree; no four-path physical collision. Three preserved dirty worktrees: G1a ` M .github/workflows/ci.yml`; Product compatibility ` M tests/product-catalog-schema.test.mjs`; Audience registry ` M docs/lkc-platform/COORDINATION.md`. Their indexes were empty; other inspected worktrees clean. No assertion about other clones/machines. |
| New worktree / exact delta | `E:\LKC-Portal\worktrees\lkc-esqs-security-framework`, branch `docs/lkc-esqs-security-framework`, HEAD/base `424ff4b85e99a38d888e31c0dedbff28bceb7987`; planned Draft PR base `docs/ai-delivery-governance`. CREATE only the four package paths listed below; MODIFY none. Owner Codex 2; reviewer Claude 2. |
| AC comparison / action | G0 process **REUSE**; control catalogue/evidence ledger, same-task DUP runbook and PO rollout **EXTEND** with four docs. No matching four-doc/control framework found within the checked scope. Source/DB/runtime behavior is not part of this delta. |
| Review / release state | `DRAFT_LOCAL / WAITING_CLAUDE_REVIEW`; Claude 2 NOT_REVIEWED, SEC source CI NOT_RUN, MERGE_PENDING, RUNTIME_NOT_ACTIVATED. No control is VERIFIED/PASS from preparing docs. Independent CMS and G1a work continue. Production UAT DEFERRED. |

Exact CREATE paths:

- `docs/lkc-platform/ENGINEERING-SECURITY-STANDARDS.md`
- `docs/lkc-platform/SECURITY-CONTROLS-REGISTER.md`
- `docs/lkc-platform/LKC-DUP-001-RUNBOOK.md`
- `docs/lkc-platform/PO-DECISIONS-AND-ROLLOUT.md`

The imported proposal is adapted for review: clarify A/B/C precedence and operation-scoped gates; replace truncated register purposes with full MUST requirements and specific evidence; verify official versions/URLs; correct S0 to four docs; distinguish PO-relayed review/DB reports from direct checks; keep commercial/security decisions OPEN. This is not byte-for-byte publication of the ChatGPT ZIP. Fingerprints of the four resulting files belong in the review handoff, separately from the input ZIP hash.
