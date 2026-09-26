# CMS-006 — Handoff cho Codex implementation local

Prepared: 2026-09-26. Task: Autosave. Spec bắt buộc: [CMS-006.md](CMS-006.md).
Branch: `feature/cms-006-autosave`, bắt đầu từ main merge CMS-005 `6a726baa29f18df184497c3389d69a68d9086d44` + commit tài liệu CMS-006.

## 1. Quyết định Product Owner và trạng thái phụ thuộc

PO đã cho tiếp tục lộ trình, hoãn authenticated production smoke CMS-005. Không cần yêu cầu PO kiểm tra CREATOR/ANALYST ngay để bắt đầu task này. Không đổi mục hoãn thành PASS, không đánh dấu CMS-005 COMPLETE. Implementation CMS-005 đã deploy; CI 437/437, staging 20/20 và cleanup verified là baseline có bằng chứng. Xem [release checkpoint](../reports/CMS-005-release-checkpoint.md).

Được triển khai source/test/runbook/report theo spec trong lượt local này. Chưa được chạy SSH/staging/DB/fixtures/cleanup/production, commit/push PR hoặc merge/deploy trong lượt implementation. Các bước đó giữ quy trình bàn giao đã dùng ở CMS-005.

## 2. Trước khi coding

- Kiểm tra đúng repo/branch/HEAD và status. Nếu working tree có thay đổi không thuộc task, giữ nguyên và báo; không reset/clean/stash tự động.
- Đọc AGENTS.md, installed Next guides liên quan Server Actions, revalidation, client lifecycle, cùng spec, roadmap checkpoint và transport-fix report. Không dùng stale instructions trỏ repo/OS khác.
- Đọc ArticleDraftForm/ArticleEditor, article-draft-actions/query/validation, CMS access policies, tests form/actions/Flight và staging runner/reporter/guard. Đừng chỉ đọc report.
- Xác nhận Node 22.23.2 đã có và dependency pins. Không tự dùng npm exec để tải Node; không cài thêm dependency, không đổi lockfile hoặc upgrade package.
- Không đọc .env hoặc dump process environment. Mỗi local test/build subprocess phải dùng dummy configuration; tránh kế thừa DATABASE_URL staging từ VS Code.

## 3. Thứ tự triển khai đề nghị

1. Thiết kế controller snapshots/baseline/deadline/single-flight/token/queue, các recovery barriers và lifecycle generation; thêm deterministic tests có fake clock và deferred promises.
2. Tích hợp form: manual create giữ khóa; update cho phép nhập tiếp; manual/auto chung điều phối. Sửa guard bỏ qua onChange khi pending, dirty/canonical-slug ACK, IME và navigation cleanup.
3. Safe failure cho session thiếu/hết hạn ở UPDATE action, giữ authorize-before-Article và actor/ownership/status/version checks trong transaction. Không thêm autosave write path yếu hơn.
4. Giữ JSON transport fix ở cả client và canonical output server; test rich text thật, không clone trước assertion che mất prototype bug.
5. Bổ sung form/action/query/Flight regressions; cập nhật tests manual-only ở edit route theo delta spec, giữ create-first và security invariants.
6. Thêm browser autosave scenarios cùng safe diagnostics registry/runbook. Giữ identity/provenance/artifact suppression/cleanup guards. Discovery local; browser/staging NOT RUN trong lượt này.

Nếu xuất hiện vấn đề trong phạm vi autosave, tự xử lý và kiểm chứng trong cùng lượt. Chỉ báo blocker khi thực sự thiếu môi trường/quyền hoặc cần đổi schema/auth policy/phạm vi; không dừng ở “đã lên kế hoạch” hoặc hỏi lại quyền cho việc spec đã giao.

## 4. Những lỗi phải chủ động tránh

- Debounce chỉ bao quanh save() cũ làm khóa editor hoặc rơi sự kiện gõ.
- setSaved/clearDirty vô điều kiện khi ACK cũ về; ghi đè slug mới bằng response cũ.
- Hai scheduler cho manual và auto; queue token cũ hoặc mọi revision trung gian.
- Undo về baseline cũ lúc request pending bị coi là không cần lưu.
- Lấy token mới bằng GET rồi tự retry sau EDIT_CONFLICT/lost response.
- Online event tự retry một mutation đã dispatch mà chưa biết commit.
- Revalidation/updatedAt key remount editor, mất undo/caret/nội dung chưa lưu.
- Hết session trong UPDATE phát redirect ngầm làm mất nội dung.
- Timer/subscription không cleanup, stale result từ bài A chạm bài B.
- Save trong composition tiếng Việt; unload POST cố cứu dữ liệu không có bảo đảm.
- Raw payload/getter/toJSON được stringify trước strict server validation.
- Test mới bị UNKNOWN_CASE/filtered mất bằng chứng, hoặc reporter lộ input qua raw exception.
- Tắt autosave bằng product test flag/tăng timeout/skip để giữ tests cũ xanh.

## 5. Local validation và báo cáo

Dùng lệnh thực tế của package.json. Chạy focused suite trước, rồi gate toàn bộ khi implementation ổn định. Prisma validate/generate và build dùng dummy/env-free quy trình hiện có; không connect DB. Không chạy lại cleanup CMS-004 hoặc tạo fixture CMS-005 cũ.

Tạo `docs/cms/reports/CMS-006-implementation.md` gồm:
- HEAD/branch, file thay đổi, không thay schema/dependency nếu đúng thực tế.
- State machine, snapshot/token flow, IME, dirty/navigation và error recovery.
- Safe auth response UPDATE; các server guards được giữ và test chứng minh.
- Mapping đủ CMS006-AC-01..30 và AUTO-01..24: PASS local, BROWSER NOT RUN hoặc tầng bằng chứng khác; không suy diễn test count.
- Bảng CMS-005 assertions được giữ/thay đổi, lý do business thay đổi và regression thay thế.
- Lệnh/Node/test counts thật; CI/Claude review/staging NOT RUN ở lượt local.
- Các điểm Claude cần review độc lập; git status cuối.

Cập nhật roadmap đúng checkpoint implementation nếu đã làm xong, giữ CMS-005 authenticated smoke DEFERRED. Dừng sau bàn giao review, để source/test/report UNSTAGED, không commit/push. Không gọi task COMPLETE.

## 6. Hộp thoại quyền trong lượt local

Yes cho đọc source/diff, sửa file task, chạy local tests/lint/typecheck/dummy build đã mô tả. Đọc đầy đủ lệnh trước khi cho phép; không blanket allow theo từ khóa.

No cho đọc/in secrets, npm install/upgrade, SSH/DB/staging runner/fixtures/cleanup/migration, commit/push/merge/deploy vì ngoài phạm vi lượt này. Các lệnh này sẽ có phạm vi riêng khi tới đúng bước, không phải cấm vĩnh viễn.
