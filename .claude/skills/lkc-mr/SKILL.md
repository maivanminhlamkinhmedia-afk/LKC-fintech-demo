---
name: lkc-mr
description: Publish an independently reviewed LKC task through an exact-path commit, normal push and Draft GitHub PR into its dependency base; record CI evidence. Does not merge, deploy, move dirty work or bypass protection.
---

# LKC reviewed task publication

Áp dụng [AI delivery operating model](../../../docs/lkc-platform/AI-DELIVERY-OPERATING-MODEL.md). Repository được giao: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`; xác minh Git root/origin thực tế, không giả định đường dẫn máy hoặc lấy tên package làm repository identity.

## Đầu vào

Nhận task contract: task ID/outcome, Codex owner/Claude reviewer, A/B/C, source branch/base SHA, exact paths, AC/negative tests, dependency PR/commit, exclusions, validation và quyền đã giao. Cú pháp `/lkc-mr [task-id] [commit message]` có thể bổ sung context nhưng không thay task contract.

Dùng thông tin đã có trong session/repository; không yêu cầu lại quyền hoặc prompt review đầy đủ. Nếu thiếu quyết định ảnh hưởng trực tiếp thao tác, hoàn thành phần độc lập và chỉ hỏi đúng phần thiếu. Tên branch/title/commit rõ outcome; không bắt xác nhận lại bản dịch hoặc số thứ tự khi đã được giao.

## 1. Xác minh checkpoint và review

- Kiểm branch/base/HEAD, status/index/untracked, origin, dependency head và PR hiện có để tránh thao tác trùng. Không checkout branch khác, mang uncommitted changes sang branch mới hoặc pull/merge/rebase để tiện công bố.
- Giữ đúng worktree đang được giao. Nếu cần worktree mới, tạo từ exact source ref đã thống nhất sau kiểm collision; không thay worktree bẩn. Không reset/clean/stash/force-push hoặc xóa branch ngoài nhiệm vụ.
- A không cần registry slot từng task. B cần single-writer/handoff có hiệu lực cho đúng paths; C giữ quyền thực thi riêng. Các lane độc lập không chờ toàn bộ lane khác hoàn tất.
- Chỉ công bố source sau Claude independent PASS đúng revision. Đối chiếu fingerprints và validation; author không được tự ghi Claude PASS. FAIL -> Codex fix -> Claude regression; source drift sau PASS phải xử lý evidence/review phần thay đổi trước publication.

## 2. Commit đúng allowlist

- Stage từng exact path trong task contract; không `git add -A` hoặc stage ngoài scope. Kiểm danh sách staged, `git diff --cached --check` và nội dung diff.
- Kiểm Git-normalized blobs working tree -> index -> commit; ghi riêng SHA-256 bytes khi checkpoint yêu cầu. Không coi hai loại hash là một.
- Dùng author identity đã được giao/xác minh, riêng lệnh commit bằng git -c nếu cần; không đổi global config hoặc tự gán Claude co-author khi reviewer không viết code.
- Commit message theo task/outcome. Nếu commit đã tồn tại và khớp checkpoint, xác minh rồi tiếp tục, không tạo commit rỗng hoặc duplicate.

## 3. Push và Draft PR

- Push thường lên đúng feature/docs branch và xác minh remote head/upstream; không push main hoặc force-push.
- Base PR lấy từ dependency contract, không mặc định main: ví dụ source đang stack lên foundation phải target branch foundation đã thống nhất. Không merge nhánh docs để đọc hoặc dùng registry SHA làm source base.
- Dùng GitHub connector/API hoặc gh có sẵn. Tạo Draft PR bằng create_pull_request draft=true hoặc `gh pr create --draft --base <dependency-base> --head <task-branch> --title <title> --body-file <body-file>`; body-file chứa nguyên văn Markdown đã chuẩn bị, không secrets. Không cài thêm CLI chỉ để công bố khi có công cụ phù hợp khác.
- Tìm PR cùng repo/head trước khi tạo. Nếu đã có OPEN/DRAFT đúng base thì cập nhật; nếu trạng thái/base khác contract, đối chiếu và báo drift, không tự đổi lịch sử/trạng thái ngoài nhiệm vụ.
- Dùng [PR template](../../../.github/PULL_REQUEST_TEMPLATE.md): tách author validation, Claude verdict/provenance, CI thực tế, DB/staging/runtime gates, OPEN findings và merge/release authorization. Không copy test mapping thành test PASS.
- Xác minh remote commit/parent, PR head/base và exact changed files/blobs. Nếu diff kéo thêm ancestor files ngoài contract, giữ Draft và xử lý đúng dependency, không tự merge/rebase để che diff.

## 4. CI và bàn giao

- Đọc workflow thực tại ref. ci.yml hiện auto cho PR vào main; PR dependency base có thể cần workflow_dispatch mode=validate đúng branch/source SHA theo quyền đã giao. Không dùng cms009-candidate/deploy thay validate.
- Ghi run URL/ID, attempt/event/head, checkout SHA thực tế, synthetic merge parents nếu PR run, Node/npm và từng gate/counts/skip reasons từ logs. Local PASS và CI branch khác không là source CI PASS.
- Chưa có run: NOT_STARTED/NOT_RUN cùng lý do; thiếu dispatch tool thì bàn giao operator đúng branch và mode một lượt, không coi chưa chạy là FAIL. Không commit rỗng, đóng/mở PR hoặc sửa trigger để kích CI.
- CI FAIL: đọc lỗi, sửa trong allowlist; source thay đổi cần Claude regression phần delta trước công bố revision mới. Giữ DB execution, staging, consumer integration và runtime activation là gate riêng.
- Báo commit/parent, PR head/base, remote verification, CI thật, status/index và OPEN gates; giữ PR OPEN/DRAFT. Không tự Ready, merge, xóa source branch, checkout/pull main, deploy hoặc apply migration. Production merge/deploy/DB apply chỉ theo quyền explicit riêng; không dùng admin fallback hoặc bypass protection.

Skill hoàn tất ở checkpoint Draft PR/CI/handoff được giao. Main push kích deploy.yml kể cả docs; G0 không cấp quyền merge/deploy. Manual authenticated production UAT **DEFERRED**.
