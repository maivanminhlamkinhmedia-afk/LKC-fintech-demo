<!-- BEGIN:lkc-platform-entrypoint -->
## LKC coordination update — 2026-10-08

For CMS / paid portal / product / referral / recommendation work, start with [docs/lkc-platform/README.md](docs/lkc-platform/README.md) and [CMS-INTEGRATION.md](docs/lkc-platform/CMS-INTEGRATION.md). UI v3 is approved at the UI/functionality level; implementation contracts remain subject to owner ACK. Keep CMS numbering and current work intact. Claim shared files before changing them; do not merge, deploy, migrate or run production tests just because the UI is approved.

The historical inventory below is retained, not silently rewritten. In particular, the sentence about no test runner and the legacy model/role list are not a current implementation inventory: verify `package.json`, `prisma/schema.prisma`, current source and task reports. No broad framework upgrade or legacy refactor is implied. For independent review-only work, report findings without editing source/tests.

Prototype screen 00 and review/simulation controls are not production features. See the approved 19-screen mapping, delivery boundaries and producer/consumer contracts in the new documentation.
<!-- END:lkc-platform-entrypoint -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server on localhost:3000
npm run build     # Production build (also runs type-check)
npm run lint      # ESLint

# Prisma (use ./node_modules/.bin/prisma — global `prisma` may not be available)
./node_modules/.bin/prisma generate          # Regenerate client after schema changes
./node_modules/.bin/prisma migrate dev       # Create + apply migration (dev)
./node_modules/.bin/prisma migrate deploy    # Apply migrations (production)
./node_modules/.bin/prisma studio            # GUI to inspect the database
```

No test runner is configured yet.

## Architecture

**Next.js 16 App Router** — feature-based structure. App router pages are thin shells; all logic lives in `src/features/`.

### Folder structure

```
src/
├── app/
│   ├── (dashboard)/          # Internal tool — Sidebar + Header shell
│   │   ├── layout.tsx
│   │   ├── page.tsx          # thin: imports from features/dashboard
│   │   ├── traders/page.tsx  # thin: imports from features/traders
│   │   ├── upload/page.tsx   # thin: imports from features/upload
│   │   └── reports/page.tsx  # thin: imports from features/reports
│   ├── page.tsx              # Landing homepage
│   └── gioi-thieu, san-pham, goc-nhin, kien-thuc, nha-dau-tu/
├── features/
│   ├── landing/
│   │   ├── data.ts           # All static landing content (NAV_LINKS, SLIDES, PRODUCTS…)
│   │   └── components/       # Navbar, Footer, Logo, SectionLabel
│   ├── dashboard/
│   │   └── components/StatCards.tsx
│   ├── traders/
│   │   ├── components/TraderTable.tsx
│   │   ├── queries.ts        # Prisma reads
│   │   └── actions.ts        # Server Actions (mutations)
│   ├── upload/
│   │   ├── components/       # UploadZone, BatchHistory
│   │   ├── excel.ts          # parseExcelBuffer(), detectWeekYear()
│   │   ├── queries.ts
│   │   └── actions.ts
│   ├── scoring/
│   │   └── engine.ts         # calculateScore(), getGrade()
│   └── reports/
│       ├── components/ReportTabs.tsx
│       └── queries.ts
├── components/
│   ├── layout/               # Header, Sidebar — shared dashboard shell
│   └── ui/                   # shadcn primitives (do not edit manually)
└── lib/
    ├── prisma.ts             # PrismaClient singleton
    └── utils.ts              # cn() and other utilities
```

### Adding a new feature

1. Create `src/features/<name>/` with `components/`, `queries.ts`, `actions.ts` as needed
2. Import into the relevant `src/app/` page — keep pages thin
3. Never import from one feature into another — shared logic goes in `src/lib/`

### Data flow

```
Excel file (upload page)
  → parseExcelBuffer()          src/features/upload/excel.ts
  → API route (to be built)     src/app/api/upload/
  → WeeklyEntry.rawData (JSON)  prisma/schema.prisma
  → calculateScore(rawData)     src/features/scoring/engine.ts  ← computed on read, not stored
  → UI pages / charts
```

`WeeklyEntry.rawData` stores raw Excel row data as JSON (MySQL native JSON column). Scores are **never persisted** — they are calculated on the fly by `calculateScore()` each time data is read. Changing the scoring formula retroactively applies to all historical entries without a migration.

### Two stubs awaiting spec

- **`src/features/scoring/engine.ts`** — `calculateScore()` returns zeroed placeholder. Once the scoring logic is known, implement it here. `ScoreResult` shape: `{ total: 0–100, components: {}, grade: A–F, flags: string[] }`.
- **`src/features/upload/excel.ts`** — `detectWeekYear()` returns `null`. Once the Excel template format is known, implement column detection here.

### Prisma setup (v7)

Prisma 7 moves the connection URL out of `schema.prisma` — it lives in `prisma.config.ts` (reads `DATABASE_URL` from `.env`). The schema has **no `url =`** in the datasource block. After any schema change, run `prisma generate` before building.

### Key models

| Model | Purpose |
|---|---|
| `Trader` | One row per trader; `accountId` maps to Excel identity column |
| `WeeklyEntry` | One row per trader × week. `rawData` is the entire Excel row as JSON. Unique on `(traderId, year, week)`. |
| `UploadBatch` | Audit trail for each file upload; entries link back to their batch for rollback |
| `User` | Auth only — `Role` enum: `ADMIN / MANAGER / TRADER` |

### Adding new shadcn components

```bash
npx shadcn@latest add <component-name>
```

Components install to `src/components/ui/`. `components.json` is the shadcn config.
