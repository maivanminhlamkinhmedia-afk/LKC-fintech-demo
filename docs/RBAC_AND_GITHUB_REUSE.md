# LKC Phase 1 — RBAC + reusable GitHub components

## Roles shipped in this patch
- SUPER_ADMIN
- ADMIN
- MANAGER
- SALES_MANAGER
- SALES
- CREATOR
- ANALYST
- EMPLOYEE
- CLIENT

Authorization is enforced server-side using permission helpers, not only hidden UI links.

## GitHub components reviewed

### Integrated now: OpenAlgo Charts
Why: direct fit with Next.js/TypeScript, Apache-2.0, chart engine already provides indicators/drawings/measurement capabilities. Keep it behind `src/features/chart/` so the market-data provider can be replaced later.

### Keep existing auth for this phase
The repository already depends on NextAuth 4. Do not migrate authentication merely for popularity. Better Auth is a strong future option (admin/organization plugins and permissions), but an auth migration should be a dedicated tested release.

### Refine
Strong React framework for internal tools/admin CRUD. Not integrated because LKC already has Next.js + shadcn and adding a second UI/application framework now increases complexity. Re-evaluate if the internal admin surface becomes much larger.

### Twenty CRM
Strong CRM and appropriate as an external service through its published APIs/SDKs. Do not copy the full core into LKC: most of Twenty is AGPLv3 / enterprise-licensed, and it uses its own application architecture. Add a `CRMProvider` adapter when LKC needs full pipeline/opportunity/email automation.

### Fumadocs
Recommended next for learning/documentation because it supports Next.js and is MIT. Integrate as the rendering layer while keeping LKC-owned course content.

## Next architectural interfaces
- `MarketDataProvider`
- `TradingProvider`
- `CRMProvider`
- `AnalyticsProvider`
- `ContentProvider`

External systems must plug into these interfaces instead of being imported directly into pages.
