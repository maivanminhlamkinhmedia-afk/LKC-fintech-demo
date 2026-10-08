# Phối hợp developer CMS, Portal và người tích hợp

Đề xuất vận hành để review cùng PR tài liệu. Các ownership là phân công quy trình, không phải ACL GitHub tự thực thi. Chưa tạo CODEOWNERS hoặc đổi branch protection khi chưa biết người review và quyền repo thực tế.

## 1. Các lane và trách nhiệm

| Lane | Chịu trách nhiệm | Không tự làm |
|---|---|---|
| CMS | docs/cms, Article workflow/editor/version/reader, media hiện hữu | Billing thứ hai, Subscription flag riêng, đổi referral |
| Portal | Product/Plan, Billing, Subscription, Referral, REC, UI khách | sửa raw CMS writer/state machine hoặc mở private media |
| CRM | Mở rộng referral theo scope, giữ assignment/team invariants | dùng referrer để mở toàn bộ khách ngoài scope |
| Integrator | Contract ACK, shared-file slot, migration order, PR dependencies, release | bỏ review/test vì cần merge nhanh |
| Claude QA | Review độc lập và regression theo scope | tự sửa source/assertion trong lượt review-only |
| PO | Phạm vi/giá/điều khoản/đổi yêu cầu/cho phép release | được coi là đã duyệt mọi policy vì duyệt UI |

CMS/CRM/Integrator có thể do một người đảm nhiệm, nhưng trách nhiệm vẫn phải ghi rõ. Chưa gán tên GitHub của developer nào trong tài liệu.

## 2. Các vùng có một người sửa tại một thời điểm

`prisma/schema.prisma`, `prisma/migrations/**`, `src/lib/roles.ts`, `src/lib/auth.ts`, `src/lib/authz.ts`, auth/onboarding chung, `src/components/portal/PortalShell.tsx`, globals/layout/brand components, `src/features/cms/article-*` cùng ArticleDraftForm, media storage/store/routes/cleanup, `.github/workflows/**`, package/lock và contract library.

Chỉ thay file chung sau khi có claim được Integrator ghi nhận. Hai người cùng cần sửa thì tách một PR nền nhỏ hoặc thống nhất một người làm delta; người còn lại cung cấp requirements/test. Không dùng phân quyền GitHub rộng làm lý do bỏ quy trình.

## 3. Sổ claim — một đầu mối cập nhật

| Lane | Task/branch/HEAD | Trạng thái tại bàn giao | Vùng đang giữ | Bằng chứng ACK |
|---|---|---|---|---|
| CMS — Codex số 1 | CMS-011 SPEC_DRAFT; docs/cms-011-spec / a37abc99c2057e4b100b4955694d4f62460e32a7; PR #28; base 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c | CHECKPOINT_RECEIVED; chưa implementation. CMS-011.0: SLOT_GRANTED, hiệu lực theo mốc công bố bên dưới | Đúng ba create paths tại quyết định bên dưới; modify none | CMS_OWNER_SCOPE_ACK do PO chuyển trực tiếp từ Codex số 1 ngày 08/10/2026 |
| Portal | chưa giao task implementation | PLANNED | Không có claim implementation | Chưa có |
| Integrator — phiên Codex Portal này | SUB-001 / CMS-011.0; docs/sub-001-cms-011-slot; base docs bd903b784976eb0a147844cac72fd7295a79c00b | PO_ASSIGNED; Claude PASS được PO chuyển; công bố quyết định CMS-011.0 | Registry; không claim source CMS | PO giao vai trò và chuyển CMS owner ACK trong cuộc trò chuyện ngày 08/10/2026 |

Claim hợp lệ ghi: actor, task, branch, HEAD/base, path set, contract version, PR và trạng thái. Integrator tuần tự hóa cập nhật; nếu dùng PR comments làm inbox, phải chép quyết định vào sổ trong Git. Không cho mọi branch tự tuyên bố mình có cùng slot. Claim stale chỉ giải phóng sau kiểm tra với owner, không theo timeout tự động làm mất việc.

### SUB-001 / CMS-011.0 — quyết định cấp slot, 08/10/2026 (UTC+7)

Trạng thái quyết định: **SLOT_GRANTED**. Hiệu lực bắt đầu khi commit chứa quyết định này đã push thành công lên docs/sub-001-cms-011-slot và draft PR vào docs/lkc-platform-ui-v3-coordination đã được công bố; không cần merge để đọc hoặc nhận slot. Trước hai mốc này, bản local chưa có hiệu lực. Mốc lịch sử DRAFT_LOCAL / WAITING_REVIEW được giữ trong bàn giao trước; ngày 08/10/2026 PO chuyển Claude PASS đúng delta registry và giao tiếp tục công bố. Hai ghi chú LOW không chặn; không đổi policy đã review. Cập nhật hành chính chỉ đổi trạng thái, mốc hiệu lực và ghi nhận review. CI đúng head được ghi bằng run/attempt/gates trong draft PR hoặc bàn giao; thiếu công cụ dispatch ghi NOT_RUN / TOOL_LIMITATION, không ghi FAIL và không coi là bằng chứng implementation. Không cần review lại spec hoặc CI PR #28.

| Hạng mục | Quyết định / bằng chứng |
|---|---|
| Owner / Integrator | Codex số 1 — CMS owner / phiên Codex Portal được PO giao Integrator. Claude giữ review độc lập. |
| Spec / base / branch nhận việc | [PR #28](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/28), docs/cms-011-spec tại a37abc99c2057e4b100b4955694d4f62460e32a7. Implementation dự kiến feature/cms-011-review-policy, chưa tạo theo owner. Base main 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c; docs điều phối bd903b784976eb0a147844cac72fd7295a79c00b đọc bằng ref, không merge chỉ để đọc. |
| Create paths duy nhất | `src/features/cms/article-review-contract.ts`; `src/features/cms/article-review-policy.ts`; `tests/cms-article-review-policy.test.mjs`. Modify paths: **không có**. |
| Contract scope | C03 semantic proposal tại hai tài liệu CMS của spec commit: version/revision identity, transitions và safe errors, chỉ policy/DTO cùng focused tests. Integrator ACK phạm vi semantic này cùng CMS owner ACK; không biến toàn C03 thành READY. C01 chỉ tham chiếu Product ID trong DTO; C02/C06 không tiêu thụ. |
| Loại khỏi slot | Runtime/action/route/UI/DB, public API/producer thật; schema/migrations, approval/published pointer vật lý, shared contract library, writer/autosave/form, auth/roles, media, harness, workflow/package. Self-approval và policy chưa duyệt vẫn OPEN; tests không được âm thầm chốt thay PO. |
| Nguồn ACK | PO chuyển trực tiếp CMS_OWNER_SCOPE_ACK của Codex số 1 trong cuộc trò chuyện ngày 08/10/2026: đúng ba create paths, modify none, pure scope và C03 semantics nêu trên. Owner xác nhận spec worktree sạch/index rỗng; kiểm bốn worktree CMS không thấy ba path hoặc claim trùng. Workspace CMS gốc có next.config.ts status-only M, normalized blob khớp HEAD; giữ nguyên. Đây là bằng chứng owner cung cấp, không phải Integrator trực tiếp kiểm máy CMS. |
| Kiểm overlap của Integrator | Local repo E:/LKC-Portal/LKC-fintech-demo đúng origin, main/base nêu trên, sạch/index rỗng trước chuẩn bị; ba path chưa có trên HEAD. Registry tại docs baseline chưa có Portal implementation claim; task Portal trước là tài liệu C01/C02, không có slot ba path này. Không suy không có PR thành không có việc local. Bằng chứng kiểm local CMS dựa vào ACK owner ở hàng trên. |
| Dependency trực tiếp | Main/base đã kiểm + spec commit/PR #28 + baseline docs + ACK C03 semantic scope và quyết định slot được công bố. Trước code đối chiếu main thực tế, ghi base/dependency SHA; nếu path đã xuất hiện hoặc có overlap mới thì dừng đúng boundary, Integrator xử lý. Không chờ hoàn thành Billing, Entitlements hay Recommendations; schema/pointer và C01/C02/C06 implementation ACK thuộc bước sau. |
| Bàn giao | Exact diff ba create paths, branch/base/HEAD, fingerprint và focused test evidence thực chạy; policy OPEN được giữ rõ; Claude review độc lập đúng implementation delta. Không nhận tests pure là bằng chứng runtime/schema/transaction đã triển khai. |
| Hiệu lực / giải phóng | Khi công bố SLOT_GRANTED, slot giữ hiệu lực qua các vòng implementation/review nếu phạm vi không đổi. Integrator kiểm handoff và ghi giải phóng hoặc slot tiếp; không tự hết hạn, không giải phóng vì mở PR hay tạo file. Đổi path/scope/dependency cần quyết định cập nhật. |

PR #28 hiện OPEN/DRAFT tại spec SHA nêu trên, chỉ hai tài liệu CMS; không schema/migration/source delta. PR #27 vẫn tại docs baseline và remote main vẫn tại base khi Integrator đối chiếu. Claude spec PASS, finding MEDIUM CLOSED và CI SUCCESS PR #28 là bằng chứng bàn giao PO/PR cung cấp, không thay owner ACK hoặc gate của implementation mới. Toàn SUB-001 còn mở; manual authenticated production UAT tiếp tục **DEFERRED đến cuối dự án**.

## 4. Quy tắc làm việc song song

Mỗi developer/agent dùng clone hoặc git worktree riêng, branch riêng, build output riêng. Local DB/schema, port, env, media fixture root và runId riêng theo runbook; worktree riêng không có nghĩa database tự riêng. Không chạy hai migration hoặc destructive fixture runners vào cùng staging DB.

Một staging lease cấp cho một runner có owner/commit/runId/BUILD_ID. Kiểm tra ownership trước setup/cleanup; không dọn fixture của người khác, production CMS-009 root/sentinel hoặc media thật. Harness mở rộng phải biết toàn bộ graph mới, không dùng số cleanup counters cũ như một lời bảo đảm.

Không reset --hard, clean -fd, ép checkout, auto stash hoặc force-push nhánh người khác. Khi local dirty không được ghi nhận, chỉ báo cáo và tiếp tục thao tác không phá dữ liệu. Không sửa test/assertion để làm pass ngoài delta được review.

## 5. Quy tắc PR/merge/deploy

PR nhỏ theo task, có base/head, dependency PR đã merge, scope allowed/forbidden, schema/contract delta, màn UI và test evidence. Chưa đủ gate để Draft. Một PR docs có thể review độc lập, không tự merge. Tại snapshot bàn giao push main trigger deploy, kể cả docs; phải phối hợp cửa sổ deploy với người đang làm CMS. Không dispatch lại workflow hoặc chạy migration để kiểm tài liệu.

Trước merge: đọc main/PR hiện tại, xác nhận không drift nguy hiểm, CI đúng commit, review và staging evidence phù hợp, migration compatibility, release permission. Sau merge kiểm deploy trên merge SHA thực, không dùng synthetic PR merge SHA thay actual release. Test tiếp nối được chọn theo tác động; không chạy lại mọi gate lịch sử chỉ để cập nhật docs.

Tài liệu này không sửa CI/branch protection/CODEOWNERS. Những hàng rào bắt buộc hiện chưa được coi là enforced tự động; nếu muốn thêm cần task hạ tầng riêng có PO/owner review.

## 6. Thay đổi thiết kế sau baseline

Sửa câu tiếp thị/spacing không đổi ngữ nghĩa: ghi UI revision và test tương ứng. Thay quyền, source attribution, tiền, published snapshot hoặc trạng thái: change request + migration/contracts/tests và owner consumer ACK trước code. Không viện lý do “tùy chỉnh sau” để hoãn correctness của phần đang đưa vào sử dụng.

Contract conflict: dừng đúng boundary, ghi DECISIONS, bảo toàn worktree, chỉ làm phần không xung đột. Không tự nới paid sang logged-in hoặc bỏ review để vượt blocker.
