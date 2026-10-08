# Prompt bàn giao và mẫu task

Dùng sau khi đọc README. Các prompt là công việc từng lượt, không có tự động/background monitoring. Không thực thi toàn bộ roadmap trong một prompt. Không phải lệnh PowerShell.

## 1. Gửi developer CMS đang triển khai — đồng bộ trước, không sửa code

> Đọc AGENTS.md, phần hướng dẫn mới trong CLAUDE.md, docs/lkc-platform/README.md, UI-BASELINE.md, CMS-INTEGRATION.md, ARCHITECTURE-CONTRACTS.md, COORDINATION.md và task CMS hiện tại. PO đã duyệt giao diện chức năng v3; màn 00/công cụ duyệt không lên production. Tiếp tục giữ roadmap CMS hiện hữu, không tạo CMS thứ hai.
>
> Trong lượt này chỉ báo cáo checkpoint: task CMS đang làm, branch, HEAD/base main, dirty/staged paths, PR nếu có, schema/migration chưa merge, các thay đổi dự kiến ở ArticleVersion/publishing/editor/media và gate đã thực chạy. Không reset/stash/commit hộ phần chưa được giao, không test production, không sửa code trong lượt đồng bộ.
>
> Đối chiếu C01/C02/C03/C06: CMS nhận Product catalog và entitlement chung; CMS sở hữu draft/review/version/publish/reader. Trả lại ACK/CONFLICT từng contract và danh sách file cần giữ độc quyền. Nêu việc CMS độc lập vẫn có thể tiếp tục; không tự giả định task đang là CMS-011. Nếu branch docs chưa vào main, đọc đúng branch docs được bàn giao mà không merge toàn bộ nhánh đó vào worktree đang bẩn.

## 2. Gửi developer/Codex phụ trách portal — chỉ SUB-001 trước

> Đọc AGENTS.md, hướng dẫn CLAUDE mới và toàn bộ docs/lkc-platform. Mục tiêu lượt đầu là SUB-001: nhận checkpoint CMS, xác nhận ownership/migration order và contract C01–C07 cần dùng; không code cả roadmap.
>
> Lập task nhỏ đầu tiên sau ACK: allowed/forbidden paths, dependency PR/commit, model/port delta, UI IDs, lỗi và permissions, tests, migration/rollback. Không sửa src/features/cms core, Article writer, schema/roles/media hoặc workflow khi chưa có shared-file slot. Không tạo User.isPaid, catalog thứ hai, UI đổi role giả hoặc nguồn referral từ assignedSalesId. Báo SPEC_READY/blocked chính xác, không nhận đã implement.

## 3. Mẫu checkpoint chỉ-đọc

```text
Lane / actor:
Task hiện tại:
Branch / HEAD / base main:
PR:
Dirty paths / staged paths:
Schema và migrations chưa merge:
Shared paths cần giữ:
Contract versions sản xuất / tiêu thụ:
C01..C07: ACK / CONFLICT / NOT_APPLICABLE + lý do:
Gates thực chạy + commit + environment:
Bằng chứng / hạn chế:
Việc độc lập tiếp tục được:
Việc cần Integrator quyết định:
```

Có thể lấy phần Git bằng lệnh đọc bên dưới. Chúng không thay branch hoặc thay working tree; không in .env hoặc credentials.

```powershell
git status --short --branch
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git diff --name-only
git diff --cached --name-only
```

Chỉ fetch/switch/worktree khi được giao task tương ứng và hiểu trạng thái local; không sử dụng reset/clean để làm sạch báo cáo.

## 4. Mẫu task triển khai một phần

```text
Task ID / parent / owner / reviewer / Integrator:
Status: SPEC_DRAFT (không điền PASS sẵn)
UI screen IDs / reference hash:
Business outcome và ngoài phạm vi:
Base SHA / dependencies (PR + commit đã merge):
Allowed paths / forbidden paths / shared-file claim:
Input/output contract versions / consumers:
Data source owner / schema/index/onDelete/precision:
Actor permissions / query scope / server validation:
State transitions / version/CAS / idempotency / audit:
Failure behavior (offline, unknown ACK, expired, forbidden, unavailable):
Migration preflight / execution owner / backward compatibility / rollback:
Unit/action/contract/negative/E2E/regression case IDs:
Staging lease / fixture ownership / cleanup expected graph:
Feature gate default / activation conditions:
Evidence record / review notes / known limits:
Stop conditions / handoff expected:
```

## 5. Prompt Claude review độc lập

> Review đúng diff/task/commit, không sửa source/tests hoặc đổi assertions. Đọc contract, baseline UI và shared-file claim. Kiểm đặc biệt Product/Subscription dùng chung, CMS revision audience, no-leak ngoài HTML/Flight/media, referral khác assignment, payment idempotency. Báo BUG-xxx, severity, file/line, tái hiện/bằng chứng và giới hạn; không ghi staging PASS từ local/mock/discovery. Không cleanup/rerun/production action ngoài phạm vi được giao.

## 6. Quy tắc tiếp nhận tài liệu

Bộ docs nên được review trên một PR tài liệu riêng. Chưa merge thì các developer phải được chỉ rõ branch/commit tài liệu đang dùng; không giả định file đã có trên main. Sau merge, mỗi lane nhận baseline docs commit rồi cập nhật checkpoint. Merge docs có thể trigger deploy theo workflow hiện tại; PO/Integrator phối hợp với luồng CMS trước thao tác.
