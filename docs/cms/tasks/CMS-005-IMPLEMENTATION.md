# CMS-005 — Hướng dẫn Codex implementation

Status: AUTHORIZED — Product Owner đã duyệt đặc tả qua chỉ thị “Triển khai bước tiếp theo” ngày 2026-09-24.
Repository: maivanminhlamkinhmedia-afk/LKC-fintech-demo
Branch: feature/cms-005-draft-editor-tiptap
Working directory trên máy Product Owner: D:\lkc_phase1_rbac_patch\LKC-fintech-demo
Specification: CMS-005.md — APPROVED FOR IMPLEMENTATION.

## 1. Mục tiêu của lượt làm việc

Triển khai đầy đủ CMS-005 theo đặc tả, gồm source code, unit/action tests, CI unit-test step, Playwright foundation, staging runbook và báo cáo implementation. Không dừng ở bản phân tích/plan nếu không có blocker thực tế.

Product Owner đã cho phép phạm vi và dependency installation theo metadata gate trong spec. Không yêu cầu duyệt lại các việc đã chốt. Lượt này kết thúc ở implementation report để chuyển Claude Code independent review, tiếp theo mới PR/CI rồi staging.

CMS-004 đã COMPLETE: PR #19 merged @ 9bb1a289526726e494243fb14a597345b27bfd3b, deploy/production smoke PASS, cleanup staging verified 0 articles / 0 profiles / 0 users. Không chạy lại cleanup hoặc các kiểm tra đã PASS không liên quan. Script operations/cms004-staging-cleanup.cjs là hồ sơ vận hành của task cũ, không phải setup của CMS-005.

## 2. Preflight và source cần đọc

1. Xác minh đúng repository, feature branch, git status và diff. Không reset/clean/stash hoặc ghi đè thay đổi của người dùng để ép working tree sạch. Nếu có thay đổi chưa rõ nguồn, báo các đường dẫn liên quan.
2. Đọc toàn bộ AGENTS.md, docs/cms/tasks/CMS-005.md và docs/cms/ROADMAP.md. Giữ 30 AC và 24 EDIT scenarios trong spec làm checklist.
3. Đọc schema/migration hiện tại và pattern:
   - prisma/schema.prisma, migration CMS-001 (precision updatedAt);
   - src/lib/roles.ts, auth.ts, authz.ts, prisma.ts;
   - src/features/cms/access.ts, author-profile.ts, author-profile-actions.ts, dashboard.ts;
   - src/app/creator/page.tsx, src/app/dashboard/page.tsx, PortalShell;
   - tests/cms-access.test.mjs, cms-author-profile.test.mjs, cms-dashboard.test.mjs;
   - package.json, package-lock.json, tsconfig.json, eslint config và .github/workflows/ci.yml.
4. Xác minh Node/runtime và dependencies. Nếu cần khôi phục node_modules, npm.cmd ci được phép cho dependency lockfile hiện tại với DATABASE_URL dummy. Không thay runtime chính.
5. Theo AGENTS.md, trước viết code ứng dụng, đọc các guide liên quan trong node_modules/next/dist/docs/ cho Next.js phiên bản đã cài: Server Actions, server/client boundary, error handling, route params và caching/revalidation. Nếu thiếu docs/dependency, xác định nguyên nhân và báo rõ; không dựa vào giả định API cũ.

## 3. Môi trường local và dependency gate

Lượt implementation/review dùng dummy DATABASE_URL bằng process-local env:

```powershell
$env:DATABASE_URL = "mysql://build:build@127.0.0.1:3306/build"
```

Đặt biến này trong chính shell/subprocess chạy install, tests và build. Không đọc/in file .env, secrets hoặc giá trị môi trường nhạy cảm để tìm credentials. Không sửa .env. Nếu build framework tự nạp env files, process-local DATABASE_URL dummy vẫn phải được ưu tiên. Không kết nối staging/production, không mở SSH, migrate, db push, db execute, reset hoặc seed trong lượt này.

Trước cài package mới, chạy npm.cmd view cho từng pin sau, lấy version, peerDependencies và engines:

```powershell
npm.cmd view @tiptap/core@3.31.3 version peerDependencies engines --json
npm.cmd view @tiptap/react@3.31.3 version peerDependencies engines --json
npm.cmd view @tiptap/pm@3.31.3 version peerDependencies engines --json
npm.cmd view @tiptap/starter-kit@3.31.3 version peerDependencies engines --json
npm.cmd view @playwright/test@1.63.0 version peerDependencies engines --json
```

Kiểm tra exit code và metadata của tất cả packages trước mutation package files. Các pins đã được cho phép với điều kiện tương thích Node 22 / React 19.2.4 / stack hiện tại. Nếu thiếu version, registry lỗi hoặc peer/engines không phù hợp: báo blocker cụ thể, không tự đổi version hoặc dùng --force/--legacy-peer-deps. Không coi việc spec đã được duyệt là bằng chứng registry/compatibility đã PASS.

Khi gate PASS, được cài đúng các packages trên bằng --save-exact, Playwright là devDependency; giữ package-lock.json đồng bộ. Không bổ sung framework, Tiptap Cloud/Pro, collaboration, UI scaffold hoặc package khác ngoài scope để giải quyết tiện lợi.

## 4. Thực hiện theo đặc tả

- Routes list/new/edit; dashboard có CTA phù hợp quyền. Giữ một PortalShell.
- TipTap Client Component; shared JSON schema để server kiểm tra node/mark/attribute/nesting/link/limits. contentJson authoritative; contentText derive ở server và ghi atomically.
- Tạo own DRAFT chỉ khi bấm lưu; title/slug/excerpt/articleType/contentJson là contract. Không tạo bài khi GET/mount/gõ phím.
- CREATOR own scope; ADMIN/SUPER_ADMIN có phạm vi article rộng hơn nhưng editor chỉ sửa DRAFT/CHANGES_REQUESTED. Không sửa underlying role matrix hoặc canUpdateArticle policy.
- Guard server trước query; identity từ session, recheck ACTIVE/role trong mutation. Mọi scope compose bằng AND.
- Conditional write với expectedUpdatedAt và allowed status/scope trong transaction; token phải tăng theo precision lưu thực tế. Unit mocks không thay thế kiểm chứng MariaDB ở bước staging.
- Expected errors trả về form, giữ nội dung. Không nuốt Next redirects trong catch tổng quát. Không leak nội dung bài khác/diagnostics/credentials.
- Hoàn thành UX manual save/dirty state/accessibility/responsive của editor mới.
- Thêm unit/action tests và test:unit vào CI sau Prisma generate, dùng dummy DB.
- Viết Playwright foundation + Chromium config, fixtures/runbook staging theo section 10. Credentials ngẫu nhiên cho 6 QA accounts thuộc 5 loại role; namespace cms005-e2e/runId; guard environment/actual identity; cleanup exact owned IDs + remaining counts.
- Imports/config/test discovery không được tự kết nối DB hoặc tạo fixture. Chỉ thực thi writes trong bước staging runner có guard được gọi rõ ràng.
- E2E runtime staging chỉ chạy sau Claude review + CI PASS ở giai đoạn staging. Lượt này chuẩn bị source/runbook và ghi STAGING PENDING; không báo browser/DB checks PASS khi chưa chạy.

Giữ boundary CMS-006 autosave, CMS-007 citations, CMS-008 taxonomy, CMS-009 media, workflow/publishing/versioning/SEO/audit theo roadmap. Không sửa schema/migrations, public website, deploy workflow hoặc bug duplicate-email admin trong CMS-005.

## 5. Validation local

Chạy theo thứ tự thích hợp, dùng dummy DATABASE_URL trong từng shell:

```powershell
npx.cmd prisma validate
npx.cmd prisma generate
node --test tests/*.test.mjs
npm.cmd run lint
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
git diff --check
git status --short --branch
```

Sau khi có test:unit script, xác nhận script thực sự chạy cùng full unit suite dùng trong CI. Nếu glob trên Windows không expand với Node hiện tại, dùng script Node/test discovery tương thích thay vì bỏ sót test; ghi lệnh thực tế vào report.

Kiểm tra E2E discovery/config bằng lệnh không khởi động staging (ví dụ --list khi imports đã bảo đảm không có DB side effects). Phân biệt config/discovery PASS với browser E2E NOT RUN. Không cài browser hoặc mở staging chỉ để biến trạng thái này thành PASS trong lượt implementation.

Các kiểm tra phải có mục đích: authorization/ownership/status, JSON/link/size, derived text, slug conflict, concurrency, transaction failure, fixture guard/cleanup và regression liên quan. Không thay tests bằng assertion chỉ soi chuỗi code; không nới AC để test xanh.

## 6. Báo cáo và điểm bàn giao

Ghi report vào docs/cms/reports/CMS-005-implementation.md và trả tóm tắt cho Product Owner gồm:

1. Branch, base/HEAD, working tree; file và dependency versions thay đổi.
2. Dependency metadata/peer gate và local commands đã chạy, kết quả thật.
3. Authorization / query scopes / transaction-concurrency / document validation và error mapping.
4. Mapping CMS005-AC-01..30 và EDIT-01..24: PASS / IMPLEMENTED-PENDING-STAGING / NOT RUN / BLOCKED, kèm bằng chứng đúng cấp độ.
5. Unit tests, lint, typecheck, build, diff-check; số test thực tế, không chép lại baseline 331/331.
6. Playwright readiness/runbook; browser/staging/precision/cleanup còn pending nếu chưa thực thi.
7. Known limitations và phần cần Claude review.

Không đưa .env, password, cookies, storageState hoặc credential-bearing traces vào report/commit. Bảo toàn changes và báo blocker có thể tái hiện nếu không hoàn thành; không bịa validation PASS.

Sau báo cáo chuyển Claude review-only theo quy trình. Không tự merge/deploy hoặc thực hiện database operations trong lượt implementation này.
