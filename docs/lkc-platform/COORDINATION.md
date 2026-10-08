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
| CMS | UNKNOWN — PO báo đang triển khai | WAITING_CHECKPOINT; không suy task hiện tại | Chưa nhận danh sách file; coi CMS core là vùng cần phối hợp | Chưa có |
| Portal | chưa giao task implementation | PLANNED | Không có claim implementation | Chưa có |
| Integrator | SUB-001 | WAITING_ASSIGNMENT | Registry/contract sau khi được giao | Chưa có |

Claim hợp lệ ghi: actor, task, branch, HEAD/base, path set, contract version, PR và trạng thái. Integrator tuần tự hóa cập nhật; nếu dùng PR comments làm inbox, phải chép quyết định vào sổ trong Git. Không cho mọi branch tự tuyên bố mình có cùng slot. Claim stale chỉ giải phóng sau kiểm tra với owner, không theo timeout tự động làm mất việc.

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
