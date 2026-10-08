<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:lkc-platform-coordination -->
## LKC: approved UI and concurrent CMS/paid-portal work

For CMS, paid products, subscriptions, billing, referrals, recommendations or customer portal tasks, read `docs/lkc-platform/README.md` first, then its UI baseline, contracts, CMS handoff, roadmap and coordination rules. The Product Owner approved UI/functionality v3; technical contracts still require owner acknowledgment. This is not authorization to implement the entire roadmap, merge, migrate or charge customers.

Keep the existing CMS roadmap and developer's work. Before shared schema/auth/roles/Article writer/media/PortalShell/workflow changes, record the current branch/HEAD, local changes and the single-owner integration slot. No destructive cleanup, forced reset, or taking over another branch. No PR is not proof that no developer is working locally.

Prototype screen 00 and screen/role/payment simulation controls are review-only and must not enter production. Preserve the original site identity. Paid CMS and recommendations share product entitlements; referral attribution is separate from current Sales assignment.

Treat implementation/test claims in legacy documentation as historical until verified against the current source, package and evidence. `CLAUDE.md` contains legacy inventory; do not recreate old modules or remove existing tests based on it. Follow the task-scoped delivery/review workflow and retain honest NOT_RUN/DEFERRED states.
<!-- END:lkc-platform-coordination -->
