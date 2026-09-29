# CMS-008 — Handoff cho Codex implementation local

Prepared: 2026-09-28 (UTC+7).
Spec: [CMS-008.md](CMS-008.md).
Branch: `feature/cms-008-taxonomy-instruments`.
Base: main `9bd3ec8e7cc55ebcaf8a9782868a3ac93fcc7a34` + commit tài liệu bàn giao.

## 1. Chỉ thị và phạm vi

PO yêu cầu “Triển khai cms 008”. Hoàn thành implementation local, tests/runbook/report theo spec; không chỉ đưa kế hoạch hoặc hỏi lại các lựa chọn đã được chốt.

Hai phần: admin global taxonomy catalog bốn loại và classification từng bài. Catalog admin dùng cms:admin hiện có; assignment dùng cms:access/own/any và editable draft. Shared Article token với editor/autosave/sources. Lưu thủ công, không schema/dependency/auth/deploy changes.

Nghiệm thu thủ công đăng nhập/thao tác người dùng toàn dự án đã DEFERRED tới cuối dự án theo PO ngày 28/09. Xem [ACCEPTANCE](../ACCEPTANCE.md), không coi là PASS và không dùng làm blocker cho CMS-008 local hoặc phát hành kỹ thuật sau đủ gate. Technical automated tests/review/CI/staging giữ nguyên.

Trong lượt này: không SSH/DB thật/staging runner/fixtures/cleanup/production/migration, không git add/commit/push/PR/merge/deploy implementation. Tài liệu trên feature branch là checkpoint bắt đầu, chưa có source CMS-008 đã review.

## 2. Kiểm tra và đọc trước coding

- Workspace Windows đúng repo; xác minh branch/HEAD/status/index so với commit bàn giao. Giữ thay đổi bất ngờ, không reset/clean/stash tự động, không implement trên main.
- Đọc AGENTS.md/CLAUDE.md/TECH_STACK.md. Chú ý phần test runner/models/role cũ trong CLAUDE.md stale; package/schema/source hiện tại là authority.
- Đọc ROADMAP, ACCEPTANCE, CMS-007 release checkpoint; FULL CMS-008 spec và handoff.
- Đọc schema ArticleCategory/ArticleTopic/ArticleTag/FinancialInstrument/Article/category FK/mappings/User/SourceReference; đặc biệt SetNull/Restrict/Cascade và isPrimary không có DB unique constraint.
- Đọc roles/authz/auth/access và draft/source transaction/query/controllers; ArticleDraftForm/source navigation, creator/list routes.
- Đọc CMS-005/006/007 spec liên quan quyền, token, state/unknown ACK, harness và các reports AUTO-21/FMT fixes.
- Đọc toàn bộ fixture/cleanup/runner/diagnostics/global-setup/safe-reporter/runbook, local harness tests và browser support.
- Theo AGENTS.md, đọc installed node_modules/next/dist/docs phần Server Actions, params/searchParams, revalidation, client lifecycle trước khi viết code. Dùng installed/pinned APIs, không upgrade để khớp docs khác phiên bản.

Node 22.23.2 đã có; CMS005_NODE_EXE là tên biến lịch sử hợp lệ. Không cài Node/packages/Chromium hay hỏi DB password để làm local.

## 3. Thứ tự triển khai

1. Pure contracts, exact payload validation, catalog identity/limits, classification sets/primary và safe errors. Chốt unit cases hostile data/duplicate/range/legacy.
2. Fresh scoped reads, catalog bounded search/pagination và explicit Flight DTO.
3. Catalog CRUD: immutable identity, CAS/no-op, deactivate, delete-unused guard đặc biệt category SetNull; race/rollback tests.
4. Assignment action: fresh authorization, set validation/active retention, Serializable Article CAS + exact mappings, no-op + shared token, persisted read-back.
5. Catalog/classification controllers và UI thin routes; safe offline/unknown ACK/conflict/single-flight/nav; links không phá source/editor drafts.
6. Manifest v3 catalog reservations/identities/relations/recovery/cleanup và legacy v1/v2 tests, trước browser cases.
7. TAX browser scenarios thực, diagnostic registry/static steps, scoped response barriers; giữ 55 baseline.
8. Full local gates và report mapping 36 AC/32 TAX, cập nhật ROADMAP implementation checkpoint.

Không mở rộng scope để “tối ưu chung”, không đổi autosave/controller contracts. Nếu cần trích helper nhỏ trong CMS để tránh logic security khác nhau, cover regression callers cũ và giải thích diff. Không hardcode fixture/test switches vào product APIs.

## 4. Điểm cần giải quyết bằng code/tests, không bỏ qua

- Category và Topic có active; Tag không có; Instrument primary là invariant application, không DB unique constraint.
- Catalog identity immutable: slug và instrument tuple/canonicalKey; metadata updates/no-op không mutate Article tokens.
- Delete-used Category phải từ chối trước SetNull; race assignment/delete và inactive-retention phải đúng trên transaction.
- Article classification vừa own/any vừa editable-status/schema; admin quyền rộng không vượt trạng thái.
- No-op kiểm stale token/quyền trước; không lợi dụng no-op để bypass active/existence/limits.
- Catalog and classification tokens khác domain: catalog row.updatedAt cho admin edit, Article.updatedAt cho mapping. Không dùng catalog token thay Article token.
- Một TX parent/category/mappings, no-op không write, failed child rollback token; primary0..1 thuộc instrumentIds.
- Hai chiều classification↔autosave và classification↔sources giữ losing input, không tự refresh/retry.
- Browser catalog CREATE lost ACK không duplicate; late ACK/search result không sửa form instance mới hoặc dirty selection.
- DTO/strict validators không stringify hostile payload; không accessors/toJSON hoặc error raw dumps.
- Global catalog không có creator field: seed/reserved natural-key intents + pre-absence + exact matching là bắt buộc cho recovery. Không prefix ownership.
- Cả fixture Article→foreign catalog và fixture catalog→foreign Article đều chặn cleanup; category reverse refs và mapping both-endpoints.
- Legacy manifests không nâng quyền; tất cả recovery entrypoints nhận v3 explicit;13 counters bằng 0 thật chỉ sau TX+postcommit.
- cms-sources.spec.ts beforeAll hiện yêu cầu version===2: sửa riêng setup gate/recovery hooks để nhận v3 hợp lệ, giữ nguyên provenance và business assertions. V1/v2 unit fixtures vẫn có setup riêng để kiểm quyền cũ.
- Existing source NOTE-01 không thuộc bug cần sửa của task này.
- Native input/paste/focus/reload fixes và assertions55baseline không bị nới.

## 5. Môi trường local và gates

VS Code có thể đang kế thừa DATABASE_URL staging. Chạy validation trong process con với allowlist OS env + DATABASE_URL/NEXTAUTH_* giả, không đọc .env/dump env hoặc dùng staging URL làm default. Build dùng env-free isolated snapshot theo quy trình đang có; không đụng snapshot staging/lượt release trước.

Prisma validate/generate qua dummy/env-free config; không migrate/db pull/db push/studio/seed. Không npm install/npm ci/upgrade/lockfile change vì task không có dependency mới. Nếu runtime/dependencies thật sự thiếu, báo mục thiếu, không tự tải thay thế.

Gates:
- Focused validators/actions/queries/controllers/components/catalog↔article concurrency và negative fixture recovery/cleanup.
- Full npm run test:unit, baseline 612 + tests mới; báo count thực.
- Prisma validate/generate, lint, tsc --noEmit, isolated production build.
- Playwright discovery55baseline +N TAX thực tế; báo titles/steps mapping, không chạy browser suite/DB.
- git diff --check và whitespace/conflict markers ở untracked files.

Tests phải chạy modules/components/actions thật hoặc adapters có contract rõ, không mock lại chính implementation rồi tự PASS. Test-only mocks không chứng minh MariaDB/browser behavior. Không bắt một số unit/browser cases đoán trước; map 36 AC/32 TAX đủ và khai báo case grouping.

Chỉ chạy lại gates bị ảnh hưởng nếu fix sau validation. Không full-suite/build lặp khi chỉ cập nhật report. Không tăng timeout/retry, skip case, bỏ DB assertions hay thay UI thực bằng directJSON để lấy PASS.

## 6. Implementation report và bàn giao Claude

Tạo `docs/cms/reports/CMS-008-implementation.md`:
- Branch/base/start HEAD, file list/diff scope, schema/dependencies/auth policy giữ hay thay thực tế.
- Hai surfaces và error/state contracts; instrument canonical identity/legacy behavior.
- Catalog CAS/delete guards, Article transaction/no-op/preserved fields; action order và concurrency evidence.
- Search paging/selected retention, UI navigation/offline/late ACK/unknown outcome.
- Manifest v3 schema/intent provenance/catalog and mapping graph/legacy support;13counter verification path.
- Mapping CMS008-AC-01..36 và TAX-01..32, L/B thật;27 L+B / 5 L-only (04/12/27/28/29).
- Giữ 55 baseline; mọi legacy delta giải thích rõ assert cũ/mới.
- Commands/runtime/counts thật; discovery không là browserPASS, local mocks không là DB cleanupPASS.
- Review checklist tập trung file/diff mới; Claude review/CI/staging NOT RUN.
- Manual UAT DEFERRED theo PO; không ghi CMS-008 COMPLETE/DEPLOYED trước release.
- Git status/index cuối, toàn bộ source/test/runbook/report UNSTAGED.

Cập nhật ROADMAP local implementation status, không đổi checkpoint evidence của CMS-007 hay nghiệm thu DEFERRED thành PASS. Không git add/commit/push. Sau report, bàn giao Claude independent review; không tự chạy staging để “xác minh nốt”.

## 7. Quyền Yes / No

| Thao tác cụ thể trong hộp thoại | Lựa chọn |
|---|---|
| Đọc spec/source/installed docs/Git/runtime metadata | Yes |
| Sửa source/tests/runbook/report trong scope CMS-008 | Yes |
| Unit/lint/tsc/discovery/Prisma validate-generate/build với dummy env đã cô lập | Yes |
| Đọc/in .env, DATABASE_URL thật, passwords/cookies/full env | No |
| Cài/upgrade packages/Node/Chromium, schema/migration/lockfile change | No; báo nhu cầu thật nếu thiếu |
| SSH/DB thật/staging runner/fixtures/cleanup/production | No trong local implementation |
| Git add/commit/push/ready/merge/deploy implementation | No trong lượt này |

Đọc đầy đủ lệnh và môi trường; không quyết định chỉ bằng một từ khóa, không blanket allow toàn project. Nếu bị policy auto-review chặn, báo đúng action/reason và dùng cách an toàn hơn nếu có, không vượt cơ chế kiểm soát.
