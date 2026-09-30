# CMS-009 — Handoff cho Codex implementation local

Prepared: 2026-09-30 (UTC+7).
Branch: feature/cms-009-media-library.
Base: main 89269dc806a9800f6582ea1a37a909aa60c944cd + commit tài liệu bàn giao.
Spec: [CMS-009.md](CMS-009.md).

## 1. Nhiệm vụ được giao

PO yêu cầu “triển khai cms 009”. Thực hiện implementation local đầy đủ theo spec40 AC / 36 MED, không chỉ viết kế hoạch.

Scope: library ảnh PNG/JPEG, upload thật có canonicalization, own/admin metadata+delete-unused, authenticated content, cover Article manual-save/shared CAS, durable storage journal và harness v4 DB+filesystem cleanup.

Giữ schema/role matrix/editor v1; không inline TipTap images hoặc cloud-storage account. File upload nằm ngoài deploy/public. Manual UAT DEFERRED theo ACCEPTANCE không chặn coding; không đổi thành PASS.

Trong lượt này được đọc/sửa source/tests/runbook/report, cài codec dependencies tối thiểu sau metadata gate, chạy local synthetic codec/browser/standalone probes với dummy env. Không real DB/SSH/staging/production, migration, git add/commit/push/PR/merge/deploy implementation. Toàn bộ delta cuối UNSTAGED cho Claude independent review.

## 2. Preflight và source cần đọc

- Fetch origin, kiểm branch docs đã được bàn giao, exact HEAD/parent/status/index. Không triển khai trên main hoặc cms-008 branch. Nếu local branch chưa có, switch --track branch remote đã có sau kiểm working tree sạch. Không reset/clean/stash hoặc ghi đè thay đổi bất ngờ.
- AGENTS.md và installed node_modules/next/dist/docs về Node Route Handlers/streaming/auth/Server Actions/standalone tracing/client lifecycle; package/schema/source thật ưu tiên tài liệu stale.
- Toàn bộ CMS-009 spec, operations/cms009-media-storage.md, ROADMAP, ACCEPTANCE, CMS-008-release-checkpoint.
- Schema MediaAsset/Article/User/FK SetNull; roles/authz/access, draft/source/classification actions/query/controllers; editor schema v1.
- Creator/list/editor/sources/classification routes và dirty-navigation semantics.
- Toàn bộ runner/guard/fixtures/cleanup/taxonomy-fixtures/diagnostics/reporter/global-setup/runbook + relevant tests.
- deploy.yml/next.config.ts: workflow xóa public và loại sharp, nên không thiết kế file persistence dựa vào hai thứ này.
- Đọc local synthetic probes và các fix AUTO-21/FMT, scoped request matcher/alert, TAX timeout metadata để không đưa regression cũ trở lại.

Node 22.23.2/CMS005_NODE_EXE, Playwright1.63.0 đã có. Không cài lại runtime/browser. Source env có thể đang chứa staging DB: subprocess local phải allowlist OS + dummy DB/auth và scratch media root; không đọc .env/dump inherited env.

## 3. Thứ tự implementation

1. Contracts/authorization/limits/errors, metadata DTO and immutable managed identity. Unit hostile shapes, token precision, scope and legacy.
2. Pure codec adapter + isolated worker + bounded resource and raw-stream validators. Chọn/pin dependencies có bằng chứng; fixtures synthetic PNG/JPEG/alpha/EXIF orientation/malformed/oversize.
3. Storage adapter: explicit private root/marker, exact safe paths, atomic exclusive writes/journal/operation locks. Real temp-files tests + synthetic DB adapters ở mọi fault boundary.
4. Upload intent/raw Route Handler/status + authenticated GET/HEAD; origin checks before body, lost-ACK recovery and no blind replay.
5. Media list/search/metadata CAS/delete-unused, no implicit SetNull; cover query/action Article CAS và common row-lock protocol.
6. Controllers/UI/thin pages/links, single-flight/error/offline/dirty navigation. Không đổi autosave API payloads.
7. V4 harness: storage-root lifecycle, exact assets/edges/receipts and 15 DB+4 filesystem cleanup. Legacy unit fixtures explicit versions.
8. Browser MED scenarios thật + static safe diagnostics; bảo toàn90 baseline và timeout exceptions.
9. Full local gates, assembled standalone smoke, report và ROADMAP checkpoint; bàn giao Claude review.

Tên file/helpers linh hoạt theo architecture; tách server-only storage, pure validation, query/action và client controllers. Không broad refactor domain khác, không product test backdoor, không tự sửa permissions để test dễ hơn.

## 4. Dependency và deploy compatibility gate

Được cài exact-pinned minimal pure-JS/portable codec packages + types cần thiết, không xin lại quyền này.
Trước install:
- Đọc npm registry metadata/license/engines/peer deps và advisory/audit cho exact candidate; dùng primary sources.
- Xác minh Node 22 và Windows/Linux, không transitive native sharp bắt buộc.
- Dry-run/resolution trong môi trường dummy/scratch nếu cần; không force/legacy-peer-deps.
- Giữ pins Next/React/Prisma/TipTap/Playwright; ghi rõ package.json/package-lock delta.
- Sau install, audit phần dependency mới và kiểm actual codec resource options. Nếu có vulnerability ảnh hưởng trực tiếp chưa giải quyết, chọn candidate phù hợp khác hoặc báo blocker cụ thể, không lờ đi.
- Không coi npm metadata hoặc unit test là bằng chứng standalone. Build snapshot và assembled bundle phải thực sự load worker/codec, canonicalize synthetic sample trên temp root mà không cần dev source.
- Nếu cần outputFileTracingIncludes hoặc asset copying: diff tối thiểu, giải thích Node worker path và chứng minh khi chạy từ bundle mới. Không sửa deploy.yml trong local task; nếu thực sự cần thay workflow ngoài tracing thì nêu bằng chứng và đề xuất riêng.

Không đặt versions chưa kiểm làm requirement giả. Report ghi exact packages/versions thực đã chọn và lý do.

## 5. Các điểm không được làm yếu

- Không sử dụng file extension, client MIME, Content-Length hoặc image-size header như full image validation.
- Decode/re-encode và normalize orientation trước strip metadata; bounded input/output/pixels/worker và stream cancellation thật.
- Không request.formData()/arrayBuffer() vô hạn trước byte cap; không tăng global Server Action body limit.
- Route Handler mới có auth/CSRF riêng; không dựa Server Action protections cho raw POST.
- Không client-controlled file root/key/url; managed media marker/receipt khác legacy; không fetch remote URLs.
- DB/FS không atomic: journal, unknown commit handling và exact reconciliation bắt buộc; catch không đồng nghĩa rollback.
- Không unlink khi chưa biết DB outcome, không fake delete-success lúc file cleanup pending.
- Delete-used kiểm all Article owners/statuses, lock tương thích cover attach; SetNull không thay user-confirmed clear.
- Cover update shared Article token, editable + supported document, preserve body/source/classification/owner. No-op vẫn auth/token trước.
- Metadata asset không bump Article token; binary immutable.
- Lost ACK giữ operation identity; không create/upload replay với id mới hoặc auto retry stale writes.
- Storage root/codec worker không được khởi tạo bởi import/discovery/build.
- Legacy v1/v2/v3 zero media permission; v4 kiểm cả hai đầu và foreign reverse reference.
- Cleanup15 DB trong TX+postcommit +4 filesystem counters cuối; không claim19 counters cùng rollback trong DB TX.
- TAX-08/TAX10 đều120s như baseline;88 case cũ khác60s, expect 10s. Cases mới60s. Chia tests hợp lý; không tăng timeout/retry hoặc bỏ assertions để lấy PASS.
- TIMING.testTimeoutMs có thể stale60000; giữ caveat, không sửa reporter chỉ để hiển thị120000.

## 6. Validation local

Tất cả trong subprocess sanitized, dummy URL/auth, temp media roots thuộc workspace/scratch riêng:
- Focused contracts/auth/actions/codec/storage/journal/cover concurrency/controller/component tests.
- Real filesystem fault probes; crash/rename/unlink/ambiguous commit adapters không phải MariaDB thật.
- Local browser component/loopback integration được phép với dữ liệu synthetic, chặn external origin, không session/DB thật.
- Full npm run test:unit: baseline788 + new; báo actual count, không nhắm một số test dự đoán.
- Prisma validate/generate config dummy; không migrate/db pull/push/studio/seed.
- Lint; TypeScript --noEmit --incremental false.
- Env-free isolated next build và assembled standalone media worker/storage smoke; không xóa/sửa snapshot staging cũ.
- Playwright discovery90+N MED; không chạy guarded browser staging. Báo actual titles/static steps/grouping.
- git diff --check và scan untracked whitespace/conflict markers.
- Scope check schema/auth/unsafe deploy changes; build artifacts phải ở ignored temp dirs.

Chỉ rerun gate cần thiết sau khi có delta/rủi ro; không full-suite/build lần nữa chỉ do sửa report.

## 7. Báo cáo và trạng thái cuối

Tạo docs/cms/reports/CMS-009-implementation.md:
- Start/base HEAD, exact file inventory, metadata/dependency/lockfile/tracing changes.
- 40 AC / 36 MED mapping,29 L+B và 7 L-only (04/06/07/25/30/31/32), L/B evidence thật.
- Actor/scope/raw-endpoint CSRF/managed-byte auth, codec choices và actual limits.
- DB/FS phase diagram/table, operation ownership/expiry/quota/replay, lock recovery và từng failure outcome.
- Delete/cover row-lock order, unknown commit safety, CAS/no-op/preserved-fields/timestamp precision.
- Private root/path checks, legacy behavior, local standalone proof; production root/proxy/backup NOT VERIFIED.
- Manifest v4, root marker/operation journal, 15 DB+4 filesystem cleanup path và negative tests; legacy cases version pinning.
- Baseline90 assertion deltas nếu có, giải thích chính xác và không nới mục tiêu.
- Commands/runtime/counts, synthetic source, limitations, Claude review/CI/staging NOT RUN.
- File list + git status/index cuối: implementation/test/docs đều UNSTAGED; không commit/push.

Cập nhật ROADMAP bằng implementation checkpoint mới; giữ release CMS-008 và manual UAT DEFERRED. Khi được giao release sau này mới provision root thực theo runbook. Không dùng thiếu production root để bỏ implementation hoặc tự chạy SSH.

## 8. Quyền và phạm vi

| Thao tác | Trong local task |
|---|---|
| Read source/docs/Git/npm metadata/installed docs | Được |
| Write CMS009 source/tests/runbook/report | Được |
| Minimal exact codec packages sau gate, lockfile update | Được |
| Unit/local synthetic browser/real temp-files/standalone + dummy validation | Được |
| .env/secrets/real DB/staging/SSH/production | Không |
| Schema/migration/role policy/TipTap image schema/cloud account | Ngoài scope |
| Stage/commit/push/PR/merge/deploy implementation | Chờ Claude independent review và checkpoint tiếp theo |

Nếu công cụ/policy chặn, nêu action/reason thật và dùng phương án an toàn tương đương khi có; không vượt guard. Đừng hỏi lại lựa chọn đã chốt hoặc chạy lại các gate CMS-008 đã hoàn tất.
