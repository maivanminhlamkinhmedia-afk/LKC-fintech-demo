<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:lkc-ai-delivery-governance -->
## LKC delivery governance

Follow [AI-DELIVERY-OPERATING-MODEL.md](docs/lkc-platform/AI-DELIVERY-OPERATING-MODEL.md) for task contracts, lane ownership, independent review, publication and evidence.

- ChatGPT owns BA, solution architecture and cross-team coordination. Codex 1 + Claude 1 own CMS; Codex 2 + Claude 2 own Portal/Product. Codex implements; Claude reviews without editing source/assertions or committing in review-only work.
- A (lane-private): Codex 1 has standing ownership of internal CMS files, including `src/features/cms/article-*` and ArticleDraftForm; Codex 2 has standing ownership of private Portal/Product files. When no B boundary, cross-team consumer interface or overlapping claim/local work applies, the owning team completes implementation, tests, its Claude review, fixes/regression, Draft PR and CI without a registry slot for each task or a new ChatGPT prompt. Standing ownership still means one writer per file.
- B (shared/single-writer): Prisma schema/migrations, shared contract library/composition, auth/roles and shared auth/onboarding, `src/components/portal/PortalShell.tsx`, shared globals/layout/brand components, media storage/store/routes/cleanup, workflows, package/lock and any file with an overlapping active claim or cross-team consumer interface. Require one owner, exact scope, dependency commit and explicit handoff before changes; a lane namespace alone never makes these paths A. Preserve the boundaries in registry §2 until formally reconciled/amended.
- C (high risk: production merge/deploy, real DB migration, payments/Billing/Entitlements, authorization/sensitive data, trading-recommendation publication or open business decisions): prepare authorized code/tests/evidence; execution or unresolved policy needs the applicable explicit approval. Existing authorization persists; do not ask again for the same authorized action. Shared C work also follows B.
- Verify workspace, origin, branch/base/HEAD and dirty/staged paths. Use isolated worktrees and outputs. Preserve other work; never carry uncommitted changes to another branch, reset/clean/stash/force-push, bulk-stage unrelated paths or delete branches outside the task.
- Claude PASS applies only to the inspected revision. Do not invent a review verdict, owner ACK or test/CI result. Track bytes SHA-256 separately from Git-normalized blobs, and compare reviewed working tree -> index -> commit before publication.
- After independent PASS, commit only allowed paths, push normally and create/update an OPEN/DRAFT PR into the actual dependency base. Record real CI head/checkout/attempt/runtime/results; local PASS is not source CI PASS.
- Main push triggers production deployment through deploy.yml, including documentation merges. G0 authorizes no merge/deploy, DB apply, workflow/protection changes or runtime activation. Do not read/print .env, credentials or customer data. Manual authenticated production UAT remains DEFERRED.

PO precedence: the new decision replaces per-task registry requirements only for lane-private A work. The shared/single-writer B boundaries in [registry §2 at 3d724205](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/3d7242059115aa9220ad01c4cadfc0d680c4d1b4/docs/lkc-platform/COORDINATION.md) still apply until formally reconciled/amended; effective claims/handoffs are not revoked or overwritten by G0. If a CMS or Portal file has another team's active claim, Integrator must resolve the collision before editing. A classification grants no merge, real DB migration or runtime activation rights; C gates remain separate. The workflow skill [.claude/skills/lkc-mr/SKILL.md](.claude/skills/lkc-mr/SKILL.md) follows the same boundaries.
<!-- END:lkc-ai-delivery-governance -->
