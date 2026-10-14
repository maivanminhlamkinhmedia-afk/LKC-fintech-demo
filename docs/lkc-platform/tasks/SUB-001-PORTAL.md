# SUB-001.PORTAL — C01/C02 và bước nền Product catalog

Ngày: 08/10/2026 (UTC+7). Trạng thái: **DOCS_DRAFT / WAITING_CLAUDE_REVIEW**; runtime NOT_IMPLEMENTED trong delta này. Owner: **Codex số 2 — Portal**, đồng thời Integrator checkpoint CMS-011.0; reviewer: Claude independent. Không ghi toàn SUB-001 COMPLETE.

## Baseline và phạm vi

Repository maivanminhlamkinhmedia-afk/LKC-fintech-demo. Source/base main `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`. Docs đọc bằng ref [PR #27 baseline](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/tree/bd903b784976eb0a147844cac72fd7295a79c00b/docs/lkc-platform): README, UI-BASELINE, ARCHITECTURE-CONTRACTS, CMS-INTEGRATION, REC-PRODUCT-MODES-ADDENDUM, ROADMAP, DECISIONS, COORDINATION và TASK-HANDOFF. Không merge nhánh docs để đọc.

[CMS spec PR #28](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/tree/a37abc99c2057e4b100b4955694d4f62460e32a7/docs/cms/tasks) vẫn proposal. [Slot registry PR #29](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/18bac5cf6729a1e8c3a1d96b0a4e8981fcb2ead0/docs/lkc-platform/COORDINATION.md#L34) đã cấp CMS-011.0 cho Codex số 1, chỉ ba create paths của CMS, modify none. Không nhận source CMS, không sửa/thu hồi slot, không hỏi ACK lại; CI registry riêng không chặn slot. C01/C02 consumer ACK chưa có, không suy từ C03 semantic ACK.

Outcome lượt này: [C01 semantic catalog](../contracts/C01-PRODUCT-CATALOG-v0.1.md), [C02 semantic entitlement](../contracts/C02-PRODUCT-ACCESS-v0.1.md), kế hoạch task nhỏ và [report kiểm thực](../reports/SUB-001-PORTAL-local.md). Bốn path này là allowlist duy nhất; không sửa registry, docs/cms, source/tests/schema/migrations, auth/roles, shared library, writer/media, UI/shell, workflow/package/lock hoặc instructions. Không cài dependency/build/app/DB/staging/SSH/merge/deploy. Diff UNSTAGED/UNTRACKED, index rỗng cho Claude review.

Không tìm thấy gói `E:/LKC-Portal/handoffs/SUB-001-PORTAL-v1` và parent handoffs lúc kiểm; không giả đã đọc README/spec/manifest ngoài repo. Đây là bản soạn từ refs chuẩn theo giao việc tiếp tục, không nhận copy byte-for-byte từ gói. Không có manifest để xác minh; không yêu cầu PO gửi lại nguồn có trong Git. Không nhập HTML/reference/gói vào repo.

## Yêu cầu giữ nguyên

Năm Product: Chứng khoán cơ sở, Chứng khoán phái sinh, Hàng hóa phái sinh, Vàng, Tài sản số. Mỗi Product bao gồm đủ khuyến nghị thủ công, tự động từ hệ thống ngoài, vùng và xu hướng xác suất; quyền Product không chia bán từng tab hoặc mở Product khác. Nhóm hiển thị khác nguồn STAFF/WEBHOOK; chưa làm webhook, thuật toán xác suất hoặc giao dịch. CRM chỉ bổ sung ở lane Portal; CMS ở PC kia giữ màn 14–15 và roadmap. Màn 00/prototype/giả quyền không vào app.

## Đề xuất bước tiếp theo — SUB-002.0 (chưa được cấp slot code)

Subtask của SUB-002 Product/Plan trong roadmap, không mã CMS mới. Outcome: DTO/validation/pure policy catalog cho C01, chứng minh identity Product khác plan/instrument và năm × ba bằng fixtures; không catalog runtime/static seed thay producer DB. Owner dự kiến Codex số 2; Claude review độc lập; Integrator ghi scope/slot riêng trước code. Branch dự kiến `feature/product-catalog-policy`, chưa tạo. Không triển khai cùng Billing/Entitlements/Referral/REC.

| Hạng mục | Đề xuất boundary |
|---|---|
| Create paths dự kiến | `src/features/products/product-catalog-contract.ts`; `src/features/products/product-catalog-policy.ts`; `tests/product-catalog-policy.test.mjs` |
| Modify paths | Không có. Cả ba path là proposal, chưa claim/slot/code |
| Forbidden | prisma/schema.prisma/migrations; src/lib/contracts/**; auth/roles; CMS article-*/form/media; PortalShell/routes/UI; Billing/Subscription/Referral/REC implementation; scripts/harness; workflow/package/lock |
| Dependencies trực tiếp | C01 v0.1 producer scope + Claude review delta docs này; main thực tế được kiểm lại trước code và base SHA ghi nhận; Integrator kiểm overlap, cấp đúng ba path. Không chờ CMS hoàn thành hoặc C02/Billing/REC runtime |
| Consumer boundary | Pure feature-local module không được feature khác import trực tiếp. Extract shared port/composition khi có consumer ACK và slot src/lib/contracts riêng; không nối CMS/C01 producer thật trong .0 |
| Source/data | Test fixtures only; Product/Plan persistence, stable ID generation/migration/seed và server authorization chưa triển khai. Không production mocks hoặc hard-code giả catalog |
| Shared-file slot cần | .0 vẫn cần Integrator ghi claim/path dù không sửa shared files. Chưa cấp slot Portal; CMS slot không cấp quyền .0. Schema/shared library/writer/roles slot không thuộc .0, xin riêng đúng bước cần dùng |
| Gate/handoff | Focused pure tests thật, exact diff/base/HEAD/fingerprint; Claude review, CI đúng head sau quyền publish. Trả UNSTAGED trước review, giữ NOT_RUN cho gate chưa chạy; không DB/staging mặc định |
| Stop/rollback | Nếu path đã tồn tại/claim trùng hoặc cần runtime/schema/shared file thì dừng boundary và điều chỉnh scope qua Integrator; không reset/clean/stash. Pure module chưa nối runtime nên rollback trước activate không đụng dữ liệu |

### AC và test mapping của SUB-002.0 — tất cả NOT_RUN

| AC | Điều kiện | Test dự kiến / giới hạn |
|---|---|---|
| PCAT-AC-01 | Product ID opaque/stable, rename không đổi; plan/instrument không là Product | PCAT-T01 identity + C01-T01/T08; persistence sau |
| PCAT-AC-02 | Năm Product × ba groups, không pricing/tab hoặc quyền chéo | PCAT-T02 matrix + C01-T02; fixtures không seed/live |
| PCAT-AC-03 | Input thiếu/empty/duplicate/unknown/non-selectable safe failure | PCAT-T03 validation + C01-T03/T04 |
| PCAT-AC-04 | Sale stopped không tự revoke; retained policy OPEN trả unresolved | PCAT-T04 pure decisions + C01-T04/T05; không assertion thay commercial decision |
| PCAT-AC-05 | Producer unavailable không empty-success/PUBLIC fallback | PCAT-T05 test double failures + C01-T06; adapter thật sau |
| PCAT-AC-06 | CMS DTO chỉ ID/name/selectability/revision, không body/price/user | PCAT-T06 output allowlist + C01-T06 |
| PCAT-AC-07 | Chỉ ba create paths; không runtime/DB/shared imports/role delta | PCAT-T07 boundary review và changed-file check; không mirror implementation tests |

Đây là AC của task dự kiến, không PASS docs hoặc unit đã chạy. Exact test loader theo runner hiện có khi code được giao; không cài dependency để đáp ứng proposal.

### Phần tách sau .0

SUB-002 persistence/adapter cần schema/migration slot, Product ID/code/index/retention physical ACK và catalog operational policy. Migration expand-compatible, không tạo Product giả cho CMS, không sửa migration cũ. CMS C01 adapter/audience writer cần consumer ACK và writer slot riêng; reader/Billing task chỉ consume sau producer commit đạt gate. UI màn 01/02 là bước sau, giữ identity Navbar/Logo/Footer/PortalShell và baseline UI; không mở sale khi giá/kỳ/terms/benefits nguồn thực chưa chốt. Không cần đợi quyết định self-approval của CMS để làm pure Product policy.

## OPEN và ACK theo boundary

| Chủ thể / quyết định | Trạng thái / ảnh hưởng |
|---|---|
| Codex số 2 producer C01/C02 semantic scope | ACK phần mình sở hữu như ghi trong hai contract; toàn v0.1 vẫn PROPOSED_FOR_ACK |
| CMS consumer C01/C02 v0.1 | CHƯA GHI NHẬN; cần exact DTO/port/selectability/error scope trước integration, không xin lại CMS-011.0 ACK |
| Integrator slot SUB-002.0 | WAITING_SCOPE_SLOT; chưa có quyền code từ proposal này |
| Physical catalog + shared port | OPEN producer/consumer/Integrator; chặn persistence/shared adapter, không chặn docs/pure proposal |
| Giá/kỳ/activation/grace/refund/retire/historical rights | OPEN PO theo DECISIONS baseline; chặn operation/live tương ứng, không chặn mọi việc Portal |
| Source/provider/payload/auth/probability definition và UI delta | OPEN đúng REC/ingest/UI task; không tạo ba Product hoặc chặn pure C01 |
| C03/C06 schema/published/media | Không sửa, không READY; CMS-011.0 có C03 semantic slot riêng đã công bố |

## AC tài liệu lượt này và kiểm thực

Đây là 12 AC của bản task soạn từ refs, không giả là nguyên bản spec gói chưa tìm thấy. Kết quả thực ở report; không tự điền PASS.

| AC | Điều cần chứng minh | Mapping check |
|---|---|---|
| PORTALDOC-01 | Workspace/origin/base đúng, checkpoint không ghi đè | DOC-01 |
| PORTALDOC-02 | Instructions/baseline ref đúng, nguồn gói ghi trung thực | DOC-02 |
| PORTALDOC-03 | Đúng bốn paths, index rỗng, worktree khác giữ nguyên | DOC-03 |
| PORTALDOC-04 | Markdown links và source/proposed path được phân loại | DOC-04 |
| PORTALDOC-05 | UTF-8 strict, không conflict/trailing whitespace kể cả untracked | DOC-05 |
| PORTALDOC-06 | Diff-check + fingerprints trên bytes từng tệp | DOC-06 |
| PORTALDOC-07 | C01 Product/Plan/instrument, DTO, sale/selectability rõ | DOC-07 |
| PORTALDOC-08 | C02 server trust/OR/fail closed/no body, OPEN đúng scope | DOC-08 |
| PORTALDOC-09 | Năm × ba, nguồn khác group, không code ingest/quant | DOC-09 |
| PORTALDOC-10 | SUB-002.0 nhỏ, AC/test mapping đầy đủ, chưa claim | DOC-10 |
| PORTALDOC-11 | Source claims có chứng cứ, C01/C02 không giả CMS ACK | DOC-11 |
| PORTALDOC-12 | CMS slot nguyên, CI/UAT/implementation states trung thực | DOC-12 |

Sau Claude PASS đúng bốn tài liệu, quyền thường trực cho commit/push/draft PR/CI vẫn áp dụng; không hỏi lại quyền đó. Lượt này chỉ chuẩn bị UNSTAGED/UNTRACKED. Merge/deploy/migration vẫn ngoài scope; manual authenticated production UAT **DEFERRED đến cuối dự án**.
