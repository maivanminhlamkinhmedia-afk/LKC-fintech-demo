# Apply this patch to LKC-fintech-demo

This bundle is an additive Phase-1 patch for the current `main` branch reviewed on 2026-09-10.

## 1. Back up and create a branch
```bash
git checkout main
git pull
git checkout -b feat/rbac-client-sales-creator
```

## 2. Copy files
Copy this bundle over the repository root. It intentionally replaces `prisma/schema.prisma` and adds new files under `src/`.

## 3. Update Navbar
Add a visible link to `/dang-nhap` in `src/features/landing/components/Navbar.tsx`. Do this manually if you do not want to overwrite the existing Navbar design.

## 4. Install chart engine
```bash
npm install openalgo-charts@2.1.1
```
This updates both package.json and package-lock.json safely.

## 5. Prisma
```bash
npx prisma generate
npx prisma migrate dev --name rbac_client_sales_creator
```
Review the generated SQL before applying to any production database.

## 6. Environment
Add a strong NextAuth secret if it is not already present:
```env
NEXTAUTH_SECRET=<a-long-random-secret>
NEXTAUTH_URL=http://localhost:3000
SEED_DEMO_PASSWORD=<development-only-strong-password>
```

## 7. Seed development users
```bash
node prisma/seed.mjs
```
Never use the demo password in production.

## 8. Run checks
```bash
npm run lint
npm run build
npm run dev
```

## 9. Test routes
- `/dang-nhap`
- `/dashboard`
- `/dashboard/chart`
- `/admin/users`
- `/sales/customers`
- `/creator`
- `/client`

## Security acceptance criteria before production
- Do not seed default passwords in production.
- Add login rate limiting before public launch.
- Add password reset + email verification.
- Add 2FA for SUPER_ADMIN / ADMIN / SALES_MANAGER.
- Add CSRF review for all mutation paths.
- Log user/role/status changes in AuditLog.
- Never expose broker/API secrets to browser code.
- Add automated authz tests proving each role cannot access another role's data.
