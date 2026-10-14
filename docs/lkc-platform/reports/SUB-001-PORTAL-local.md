# SUB-001.PORTAL — Báo cáo local

Ngày: 08/10/2026 (UTC+7). Owner: Codex số 2 — Portal / Integrator CMS-011.0. Trạng thái: **LOCAL_DOCS_READY_FOR_CLAUDE / WAITING_CLAUDE_REVIEW**. Source/schema/UI NOT_IMPLEMENTED trong delta; toàn SUB-001 còn mở.

## Checkpoint và nguồn đã dùng

- Workspace/Git root xác minh E:/LKC-Portal/LKC-fintech-demo; origin https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo.git. Main local và remote đúng `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`, sạch/index rỗng trước ghi. Không có nhánh/worktree docs/portal-sub-001-contracts trước lượt này.
- Tạo riêng worktree E:/LKC-Portal/worktrees/portal-sub-001-contracts, branch docs/portal-sub-001-contracts từ main trên. HEAD/base không có commit mới; không switch worktree main hoặc registry, không merge docs để đọc.
- Đọc local AGENTS.md/CLAUDE.md và phần hướng dẫn tại docs baseline `bd903b784976eb0a147844cac72fd7295a79c00b`. `rg --files -g AGENTS.md -g CLAUDE.md` chỉ trả root instructions; parent E:/LKC-Portal không có hai file đó. Legacy “No test runner” không dùng làm thực trạng.
- Đọc/đối chiếu README, UI-BASELINE, ARCHITECTURE-CONTRACTS, CMS-INTEGRATION, REC-PRODUCT-MODES-ADDENDUM tại đúng baseline; ROADMAP/DECISIONS/TASK-HANDOFF dùng cho task kế tiếp. Các docs không nằm trên main, nên links baseline dùng URL immutable thay local link tới file thiếu.
- Gói E:/LKC-Portal/handoffs/SUB-001-PORTAL-v1 không tồn tại; parent E:/LKC-Portal/handoffs cũng không tồn tại. Chỉ kiểm vị trí handoffs này, không quét ổ. Không đọc được README/spec/manifest gói; **SHA256-MANIFEST và source/copy byte equality: NOT_APPLICABLE (gói không có)**. Theo giao việc tiếp tục, soạn từ Git refs; không nhận đã thực hiện 12 AC nguyên bản của spec gói. [12 AC của task hiện tại](../tasks/SUB-001-PORTAL.md) được phân biệt rõ.
- [PR #28/spec đúng commit](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/tree/a37abc99c2057e4b100b4955694d4f62460e32a7/docs/cms/tasks): đã đọc hai tài liệu trong phiên và đối chiếu lại contract table bằng connector ở SHA này. Spec còn PROPOSED; không nhập docs/cms vào worktree.
- [Registry PR #29](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/18bac5cf6729a1e8c3a1d96b0a4e8981fcb2ead0/docs/lkc-platform/COORDINATION.md#L34): slot CMS-011.0 đã công bố cho Codex số 1; ba create paths CMS giữ nguyên. Checkpoint owner về bốn worktree/scope ACK là PO chuyển từ owner, không phải kiểm máy CMS trực tiếp. Không yêu cầu ACK lại.

## Phát hiện có nguồn tại source main

| Evidence | Nhận định / ảnh hưởng |
|---|---|
| [schema main](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/prisma/schema.prisma#L430), model FinancialInstrument | Có canonicalKey unique, symbol/type/exchange/currency; là tài sản phân tích, không phải Product thương mại |
| `rg -n 'Product|Subscription' prisma/schema.prisma`: exit 1, không match; `git ls-tree` phần products/subscriptions trống | Chưa có Product/ProductPlan/Subscription/SubscriptionPeriod models hoặc hai features trên source/base đã kiểm; không suy mọi PC không có local work |
| `rg -n 'getSelectableProducts|validateArticleProducts|decideContentRead|model Product\b|model ProductPlan\b|model Subscription\b|model SubscriptionPeriod\b' src prisma/schema.prisma`: exit 1 | Các port C01/C02 trong Markdown là proposal, chưa API/source sẵn có |
| [Article/ArticleVersion](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/prisma/schema.prisma#L276) và [ArticleReview](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/prisma/schema.prisma#L505) | Không có Article audience Product edges/active approval/published version pointer; ArticleReview chưa versionId. Không đánh schema/C03 READY từ enum hoặc table tồn tại |
| [writer](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/src/features/cms/article-draft-actions.ts#L100) | updateArticleDraft có expectedUpdatedAt, scope + status CAS/updateMany và Serializable; catalogVersion proposal không thay token writer. Chưa sửa/nối writer |
| [preview query](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/src/features/cms/article-preview-query.ts#L26) | getArticlePreview đọc Article trong scope CMS, không evidence published paid reader; C02 ALLOW không mở preview cho CLIENT |
| [roles](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/src/lib/roles.ts#L49), [package](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c/package.json#L10) | ADMIN/SUPER_ADMIN có review/approve, CREATOR submit own, CLIENT không CMS; test:unit có node --test tests/*.test.mjs. Không đổi roles hoặc cài runner |

## Đối chiếu và bất đồng cần review/ACK

- C01 giữ tên getSelectableProducts/validateArticleProducts của CMS proposal, nhưng thêm usage new-selection/retained-reference và POLICY_UNRESOLVED để không tự quyết retire policy. Đây là **delta semantic đề xuất**, chưa CMS ACK/exact signature. Cần Claude/CMS đối chiếu trước adapter chung, không tự sửa CMS spec.
- C02 giữ decideContentRead và Product OR như CMS proposal; đề xuất result reason/asOf/optional entitlementRevision và explicit errors. Exact union/reason precedence/cache/revocation consistency OPEN; không nhận producer contract đã chạy.
- Billing plan snapshot khác CMS DTO; chưa chốt port/precision/price/kỳ. `[startsAt, endsAt)` được giữ là proposal từ architecture/DECISIONS, không policy PO approved; boundary tests tương lai chỉ fixtures, live chặn nếu policy chưa chốt.
- Baseline UI/roadmap có giới hạn cũ “nhập tay”; README + REC addendum ở đúng SHA đã thay giới hạn cho năm × ba. Giữ nhóm thủ công nguyên bản; không sửa hồi tố baseline/prototype, không bỏ nguồn ngoài và không coi source origin là displayGroup.
- ACK của Codex số 2 chỉ producer semantic scope mình giữ. C01/C02 v0.1 vẫn PROPOSED_FOR_ACK; CMS consumer v0.1 chưa ACK, C03/C06 physical/media không READY. Slot CMS-011.0 không bị thay đổi. Đề xuất SUB-002.0 chưa có claim/slot; full catalog schema/adapter và consumer runtime xin slot đúng bước sau.

## Kiểm tài liệu thực chạy

Đã chạy trên đủ bốn file; không lấy git diff --check đơn độc làm bằng chứng untracked sạch. Script kiểm bytes/links/allowlist/AC trả exit 0. Lần wrapper đầu dừng vì coi exit 1 của no-index diff file mới là lỗi; điều chỉnh xử lý mã difference, chạy lại cùng dữ liệu và kiểm whitespace trực tiếp bằng regex. Không sửa nội dung để che lỗi. core.autocrlf=false chỉ áp dụng lệnh no-index, không đổi config. Không có lỗi whitespace/conflict được phát hiện.

| Check / AC | Phép kiểm | Kết quả |
|---|---|---|
| DOC-01 / PORTALDOC-01 | Get-Location, rev-parse root/HEAD, origin, status, branch/worktree và ls-remote main | ĐÃ CHẠY: root/origin/base đúng; không worktree Portal trùng; local trước ghi sạch |
| DOC-02 / PORTALDOC-02 | Read instructions + git show đúng docs SHA; kiểm handoffs Test-Path | ĐÃ CHẠY: sources đúng refs; gói/manifest không có, không khai PASS byte-copy |
| DOC-03 / PORTALDOC-03 | Status --untracked-files=all, allowlist/index và status worktree khác | PASS: đúng bốn docs UNTRACKED; index rỗng; main và registry worktree sạch, không delta khác |
| DOC-04 / PORTALDOC-04 | Markdown link local resolution; immutable same-repo links kiểm path ở object/ref tương ứng | PASS: 27 links; local targets tồn tại; baseline/main/registry bằng git cat-file -e. CMS a37abc99 paths bằng connector contents/metadata; PR URLs đã đọc. Source paths và proposed create paths không lẫn |
| DOC-05 / PORTALDOC-05 | Strict UTF-8 bytes, conflict markers, trailing whitespace cả bốn untracked files | PASS: bốn files strict UTF-8; không conflict/trailing whitespace; fenced blocks đóng đủ |
| DOC-06 / PORTALDOC-06 | git diff --check + no-index /dev/null đối với từng file mới; SHA256 bytes | PASS: tracked diff-check exit 0; từng new-file no-index check không whitespace errors; hash bytes đã tính, fingerprints ở dưới/bàn giao |
| DOC-07 / PORTALDOC-07 | Đọc C01 đối chiếu architecture + CMS table + schema source | ĐÃ ĐỐI CHIẾU: identity/DTO/sale/selectability rõ; usage/retained policy là proposal chờ ACK |
| DOC-08 / PORTALDOC-08 | Đọc C02 đối chiếu architecture/DECISIONS/CMS table | ĐÃ ĐỐI CHIẾU: server trust, OR, deny, no body; interval/commercial/reason precedence OPEN |
| DOC-09 / PORTALDOC-09 | Đọc hai contracts/task so với README và REC addendum mục 1–4/6 | ĐÃ ĐỐI CHIẾU: năm × ba, một quyền/Product; origin khác group; không ingress/quant implementation |
| DOC-10 / PORTALDOC-10 | Đếm unique 12 docs AC; 7 PCAT AC với test mapping; C01/C02 test IDs unique | PASS mapping: 12 docs AC -> 12 DOC checks; 7 PCAT AC -> test IDs; 8 C01 và 9 C02 case IDs unique. Đây là kiểm mapping tài liệu, không test execution PASS |
| DOC-11 / PORTALDOC-11 | Source/model/export searches và đọc roles/preview/writer/package | ĐÃ CHẠY: kết quả ở bảng evidence; không giả CMS ACK/producer APIs |
| DOC-12 / PORTALDOC-12 | PR #29 đúng HEAD, runs/status connector và đọc registry hiệu lực | ĐÃ CHẠY: slot nguyên, workflow_runs/statuses trả rỗng; connector runs chỉ lọc PR events nên không khẳng định toàn dispatch history. CI giữ NOT_RUN theo checkpoint, không CI PASS |

Không chạy application/unit/action/contract/build/staging/migration/CI cho delta này. Runtime tests đề xuất đều NOT_RUN; manual authenticated production UAT **DEFERRED đến cuối dự án**.

## Bàn giao / điều còn thiếu

Claude review đúng bốn file mới UNSTAGED/UNTRACKED so với base main; đặc biệt C01 usage/retained policy, C02 interval/deny proposal và SUB-002.0 boundary. Sau PASS mới commit/push/draft PR/CI theo quyền thường trực; không xin lại cùng quyền, không merge/deploy.

CMS consumer ACK C01/C02 exact v0.1 còn thiếu trước integration; PO commercial policy OPEN chặn live boundary tương ứng; Integrator slot SUB-002.0 chưa cấp. Không có blocker đối với chuẩn bị docs này và không bắt CMS-011.0 chờ.

CI registry PR #29 riêng: **CI NOT_RUN — operator dispatch ci.yml, mode=validate, branch docs/sub-001-cms-011-slot**, khi chưa có run thật được cung cấp/kiểm. [Actions](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/workflows/ci.yml). Công cụ hiện có không dispatch; không commit rỗng/đổi trigger/đóng mở PR, không chặn CMS slot.

Fingerprints SHA256 bytes của ba file ổn định trước ghi report:

| File | SHA256 |
|---|---|
| SUB-001-PORTAL.md | 3ed948beace44724f7207bc56f9d78ae9775cc1d356790f1ad75833b23722cc2 |
| C01-PRODUCT-CATALOG-v0.1.md | 843c2f018fe3bf5ac3fc2b70ea490bfe78d08159e9fc72ecd728f59e761d855c |
| C02-PRODUCT-ACCESS-v0.1.md | a74a24d6201e18ea73f33e3d853b92ccaf3194410334c9ce6755c77fe0559448 |

Hash report cuối trả cùng bàn giao, không nhúng vào chính report để tránh vòng tự tham chiếu. Không có nguồn gói để chứng minh source/copy equality. Không tuyên bố whole SUB-001 COMPLETE hoặc APIs triển khai. Không phát hiện path/content conflict; những semantic OPEN ở trên vẫn cần review/ACK đúng boundary.
