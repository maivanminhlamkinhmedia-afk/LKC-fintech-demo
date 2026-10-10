# LKC AI Delivery Operating Model

G0 — mô hình vận hành được PO phê duyệt ngày 10/10/2026; tài liệu đang **DRAFT_LOCAL / WAITING_CLAUDE_REVIEW**. Governance review/publication không là source implementation PASS, shared slot mới, quyền merge/deploy hoặc runtime READY.

Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`. G0 source base từ origin/main đã đối chiếu: `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`. Các nhận định về package/workflows/source bên dưới gắn với base này; kiểm lại ref khi thực thi. Không giả định tài liệu hoặc source đang ở Draft PR đã vào main.

## Vai trò và quyền thường trực

| Vai trò | Trách nhiệm |
|---|---|
| PO | Phạm vi sản phẩm, business policy và phê duyệt thực thi rủi ro cao/release. |
| ChatGPT | BA, Solution Architect và điều phối liên nhóm; giải quyết boundary/dependency/decision mới. Không là cổng trung chuyển từng thao tác trong lane. |
| Codex 1 + Claude 1 | CMS: Codex triển khai/fix/publication; Claude review-only độc lập. |
| Codex 2 + Claude 2 | Portal/Product: Codex triển khai/fix/publication; Claude review-only độc lập. |
| Integrator được giao | Single-writer ownership, shared-file handoff, dependency commit và tích hợp ở boundary chung; không thay reviewer hoặc ACK thay owner khác. |

Trong task/scope được giao, mỗi nhóm tự đi hết implementation -> tests -> Claude review -> fix/regression -> commit/push -> Draft PR -> CI -> handoff. Không yêu cầu ChatGPT viết lại prompt review khi task contract/checkpoint đã đủ. Quyền và ACK đã nhận tiếp tục có hiệu lực đúng phạm vi, không hỏi lại mỗi vòng. Thiếu công cụ nối reviewer không cho phép Codex tự nhận Claude PASS: bàn giao checkpoint cụ thể và ghi WAITING_REVIEW.

## A/B/C — phân loại tại task contract

| Loại | Phạm vi | Cách nhận việc và giới hạn |
|---|---|---|
| A — Lane-private | Exact files thuộc standing ownership của lane, không chạm boundary B, consumer interface liên nhóm hoặc chồng claim/local work. Codex 1 giữ CMS nội bộ, gồm src/features/cms/article-* và ArticleDraftForm; Codex 2 giữ Portal/Product riêng. | Owner tự implementation -> Claude cùng nhóm review -> fix/regression -> Draft PR/CI; **không cần registry slot hành chính cho từng task**. Standing ownership vẫn single-writer; task contract và kiểm overlap bắt buộc, không lấy remote vắng PR làm bằng chứng máy khác sạch. |
| B — Shared | Các vùng shared/single-writer tại §2 registry, shared contracts/composition, instructions dùng chung và mọi file có active claim chồng lấn hoặc consumer interface liên nhóm; danh sách đầy đủ bên dưới. | Một writer duy nhất; chốt exact paths, owner/dependency/handoff rõ trước khi sửa. Chỉ cần Integrator tại boundary chung; không suy namespace của lane thành A hoặc chặn các phần lane-private độc lập. |
| C — High-risk | Production merge/deploy, migration trên DB thật, Payment/Billing/Entitlements, phân quyền/dữ liệu nhạy cảm, kích hoạt công bố khuyến nghị giao dịch hoặc business policy chưa được PO chốt. | Nhóm chuẩn bị code/tests/evidence trong scope được giao. Không tự quyết business OPEN hoặc thực hiện hành động production/rủi ro cao ngoài phê duyệt explicit đang có. Nếu chạm shared paths, C đồng thời tuân thủ B; không dùng nhãn C để bỏ single-writer. |

G0 thay yêu cầu xin registry slot từng task độc lập bằng phân loại A/B/C này. Các quy tắc cũ đòi slot cho mọi pure/lane-private task được thay trong đúng phần A; scope/slot B đã cấp, contract ACK, review và C gates giữ nguyên. Không tự thu hồi schema slot Product/CMS, không sửa lịch sử registry hoặc cấp audience slot từ G0. CMS M1, Product A compatibility và Audience Physical tiếp tục theo dependency thật, không chờ G0 hoặc Billing/C02 không liên quan.

### Standing ownership và đầy đủ boundary single-writer

Nguồn đối chiếu: [COORDINATION.md §2 tại 3d7242059115aa9220ad01c4cadfc0d680c4d1b4](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/3d7242059115aa9220ad01c4cadfc0d680c4d1b4/docs/lkc-platform/COORDINATION.md). G0 không sửa registry lịch sử. Các vùng B cần owner duy nhất, dependency và handoff rõ trước sửa:

- `prisma/schema.prisma`, `prisma/migrations/**`; shared contract library/composition.
- `src/lib/roles.ts`, `src/lib/auth.ts`, `src/lib/authz.ts` và shared auth/onboarding.
- `src/components/portal/PortalShell.tsx`; globals, layout và brand components dùng chung.
- Media storage/store/routes/cleanup, kể cả khi file nằm trong namespace CMS hoặc Portal.
- `.github/workflows/**`, package/lock và instructions dùng chung.
- Mọi file có active claim chồng lấn hoặc consumer interface liên nhóm.

§2 cũng liệt kê `src/features/cms/article-*` và ArticleDraftForm: single-writer vẫn được bảo toàn bằng standing ownership của Codex 1 đối với công việc CMS nội bộ loại A khi không chạm boundary B nêu trên. Codex 1 + Claude 1 tự hoàn tất implementation/review/fix/PR/CI, không xin slot hành chính từng task. Codex 2 + Claude 2 tự chủ tương tự với Portal/Product riêng; không nhóm nào được sửa đồng thời cùng file hoặc dùng namespace để bỏ qua shared boundary/claim của nhóm khác.

Thứ tự ưu tiên áp dụng:

1. Quyết định PO mới thay yêu cầu xin slot từng task đối với công việc A thuộc quyền sở hữu riêng của một nhóm.
2. Shared/single-writer boundaries tại §2 registry vẫn áp dụng cho B tới khi được đối chiếu và sửa đổi chính thức; G0 không làm chúng mất hiệu lực.
3. Các claim/handoff cụ thể đã có hiệu lực không bị G0 tự thu hồi hoặc ghi đè.
4. File CMS hoặc Portal có active claim của nhóm khác phải để Integrator giải quyết collision trước khi sửa; phần độc lập vẫn tiếp tục.
5. Phân loại A không cấp quyền merge, migration trên DB thật hoặc runtime activation; các gate C và phê duyệt tương ứng vẫn riêng.

## Task contract tối thiểu

Có thể ghi trực tiếp trong task issue/PR/handoff; không bắt tạo thêm một tài liệu hoặc registry row cho A. Khi đã đủ contract, dùng nguyên checkpoint để review và tiếp tục công việc.

| Mục | Nội dung bắt buộc |
|---|---|
| Identity / outcome | Task ID; kết quả quan sát được, scope nhỏ và tiêu chí hoàn thành. |
| Roles / risk | Codex owner, Claude reviewer, Integrator nếu B; A/B/C, quyền hiện có và OPEN decision thật sự cần PO. |
| Revision | Worktree/branch, exact source base SHA/HEAD; PR target branch, dependency PR + commit; không dùng registry SHA thay source commit. |
| Exact paths | CREATE/MODIFY/DELETE từng path, không wildcard che scope; forbidden paths và overlap/ownership check. |
| AC / tests | AC mapping tới tests có ý nghĩa, negative controls/error boundaries; tách PLANNED/NOT_RUN khỏi kết quả thực. |
| Dependencies | Chỉ commit/contract/slot/môi trường/decision thực sự cần; phần độc lập tiếp tục song song. Dependency chưa công bố ghi PENDING_COMMIT, không lấy SHA khác thay. |
| Validation / done | Focused/regression/lint/TS/build theo tác động, source CI gates, consumer/DB/staging/runtime gates và bằng chứng cần để kết thúc slice. |
| Exclusions | Những gì chưa triển khai/chưa kích hoạt; merge/release/DB authorization riêng; OPEN risks và điều kiện handoff. |

Thay paths/base/consumer semantics hoặc shared ownership phải cập nhật contract và review delta bị ảnh hưởng. Scope không đổi thì không xin lại ACK/slot mỗi vòng fix. Commercial OPEN chỉ chặn operation thực sự phụ thuộc, không chặn toàn bộ module độc lập.

## Workspace, shared handoff và an toàn dữ liệu

- Xác minh IDE/workspace, Git root, origin, branch/base/HEAD, dirty/staged/untracked trước ghi. Không chỉ đổi cwd nếu IDE đang gắn dự án khác. Dùng worktree/branch và output/temp/build riêng; không dùng chung DB/fixture root chỉ vì worktree khác.
- Giữ nguyên worktree đang review, công việc ngoài scope và changes chưa commit. Không checkout để mang dirty changes, reset/clean/stash/force-push, bulk-stage hoặc tự xóa branch. Branch/worktree đã có thì tiếp tục idempotent nếu đúng checkpoint; drift/collision phải đối chiếu, không ghi đè.
- Shared handoff ghi releasing/receiving owner, exact paths/dependency commit, review/publication conditions và thời điểm có hiệu lực. Bản local chưa chuyển quyền. Khi quyết định được review/công bố/remote verified, owner cũ ngừng sửa shared paths; chỉ owner mới sửa phạm vi được cấp.
- Slot B giữ qua implementation/review/fix khi scope không đổi; không tự release vì tạo file, mở PR hay CI PASS. Finding cần sửa foundation/schema cũ quay về Integrator để xếp thứ tự; không hai owner sửa schema đồng thời hoặc sửa published migration để tiện việc.
- Không đọc/in .env, token, raw credentials hoặc dữ liệu khách hàng trong prompt/PR/log. Dùng filtered/dummy env cho validation; không thay execution policy, dependency/Node/config ngoài task. Bằng chứng máy khác phải ghi nguồn, ví dụ “CMS owner cung cấp, PO chuyển”; không nhận là trực tiếp kiểm.

## Review protocol và evidence chain

1. Codex triển khai đúng allowlist, chạy validation phù hợp, giao changed files/diff, branch/base/HEAD, SHA-256 bytes, Git-normalized blobs và kết quả thực. AC/test mapping không phải tests đã chạy.
2. Claude review độc lập đúng revision. Trong review-only không sửa source/assertions, stage/commit/push hoặc tự cấp slot. Được inspect diff, chạy tests và negative controls trong scratch riêng.
3. Verdict PASS/FAIL ghi finding IDs, severity/status, revision và phạm vi tự kiểm. Tách rõ author evidence, reviewer execution, remote metadata và PO-relayed reports; không nhận mirror/scratch reproduction là original Git blob nếu chưa đối chiếu.
4. FAIL -> Codex sửa findings trong scope -> Claude regression đúng delta. PASS không đóng findings OPEN ngoài source/scope đã kiểm, không chứng minh DB/runtime READY.
5. Trước stage so hashes reviewed với working tree; sau stage so index; sau commit so commit blobs/parent. SHA-256 bytes khác Git blob hash; line-ending normalization không cho phép bỏ qua semantic drift. Source thay sau PASS thì review lại phần bị ảnh hưởng trước publication, không dùng verdict cũ cho revision mới.
6. Codex không tự tuyên bố Claude PASS. Nếu reviewer/tool chưa khả dụng, giữ exact checkpoint UNSTAGED và WAITING_REVIEW, tiếp tục việc độc lập được phép; không tạo vòng PREP hoặc yêu cầu owner gửi lại hồ sơ đã có.

## Draft PR, CI và điều kiện kết thúc slice

Sau independent PASS đúng checkpoint, Codex dùng quyền công bố đã giao: stage exact paths, diff-check/allowlist/blob comparison, commit, normal push, tạo hoặc cập nhật Draft PR đúng dependency base. Tránh duplicate commit/PR; xác minh remote SHA/parent, PR head/base và file diff. Dùng [PR template](../../.github/PULL_REQUEST_TEMPLATE.md) và [lkc-mr](../../.claude/skills/lkc-mr/SKILL.md); không auto-merge, admin fallback, tự Ready hoặc xóa branch.

PR evidence ghi task/owner/reviewer/risk, base/head/dependency, exact paths/AC, author validation, Claude verdict/finding status, CI, DB/staging/runtime gates, OPEN risks và merge/release authorization. Không copy secrets hay raw customer data. Không nhận local PASS là source CI PASS hoặc CI của PR khác làm bằng chứng.

Workflow hiện hành tại G0 base:

- [ci.yml](../../.github/workflows/ci.yml): pull_request vào main hoặc workflow_dispatch mode=validate; validate job cấu hình Node 22, npm ci, Prisma validate/generate, unit/action tests, lint, full TypeScript và production build. Candidate job chỉ cho cms009-candidate, không dùng thay validate.
- PR vào dependency branch không tự được trigger pull_request này; nếu cần và đã được giao quyền, dispatch validate trên đúng source branch/SHA. Thiếu tool dispatch ghi NOT_RUN và chuyển operator đúng thao tác một lượt; không coi chưa chạy là FAIL hoặc chặn slot registry nếu decision không đặt CI làm điều kiện.
- Evidence phải có run URL/ID, attempt/event/head, actual checkout SHA, synthetic merge SHA và hai parents nếu run checkout PR merge, runtime Node/npm, từng gate và counts PASS/FAIL/SKIP/CANCELLED/lý do skip thực tế. Workflow cấu hình Node 22 không tự chứng minh run đã dùng Node 22.
- CI FAIL cần đọc log, sửa scoped delta và regression nếu source đổi. Chưa thấy run ghi NOT_STARTED; không commit rỗng, đóng/mở PR, đổi base/trigger hoặc dùng workflow khác để tạo bằng chứng thay thế.

Slice kết thúc khi outcome/AC được chứng minh ở mức đã giao, independent review PASS, Draft PR đúng scope và CI gates thực tế được ghi; mọi gate chưa chạy/OPEN phải rõ. Source CI PASS không tự grant consumer integration, DB execution, runtime activation hoặc toàn task/module COMPLETE. Không hardcode tổng test count cho mọi branch.

## DB, staging, runtime và production

Viết migration file không cấp quyền apply. Prisma validate/generate, SQL review/offline diff và mock/static tests không chứng minh target MariaDB compatibility, locks/isolation/concurrency hoặc rollback. Ghi TARGET_VERSION_NOT_VERIFIED/NOT_RUN khi thiếu evidence, không suy engine version từ mysql provider hoặc adapter.

DB execution khi được phê duyệt riêng cần target version/metadata, disposable MariaDB cô lập khớp đích, exact schema/migrations/Prisma/adapter, legacy/mixed-version/composite FK/RESTRICT/partial-apply recovery/concurrency matrix; ghi commands/results và recovery evidence. DB proof thiếu môi trường không tự thu hồi immutable-commit handoff. Finding sửa schema quay về single-writer ordering.

Staging/browser cần target/lease/fixture ownership, guard và cleanup đúng graph đã review. Build/local tests hoặc Playwright discovery không là staging/browser PASS. Payment, entitlement, permissions/sensitive data, trading-recommendation publication và business OPEN giữ các gate C riêng; không dùng mocks để mở production.

[deploy.yml](../../.github/workflows/deploy.yml) đang chạy khi push main và có manual dispatch; docs merge cũng có thể deploy. **G0 không merge bất kỳ PR, không dispatch deploy, không apply migration, không đổi workflow hoặc branch protection và không kích hoạt runtime.** Manual authenticated production UAT **DEFERRED** đến cuối dự án.

## G0 checkpoint và G1 đề nghị

G0 owner Codex 2, reviewer Claude 2; loại B do sửa instructions/PR conventions dùng chung, PO đã giao exact scope. Branch docs/ai-delivery-governance từ origin/main 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c. CREATE docs/lkc-platform/AI-DELIVERY-OPERATING-MODEL.md và .github/PULL_REQUEST_TEMPLATE.md; MODIFY AGENTS.md, CLAUDE.md, .claude/skills/lkc-mr/SKILL.md. Không source/tests/schema/migration/package/workflow/registry delta. Next.js agent block giữ nguyên.

Overlap lịch sử: baseline PR #27 / bd903b784976eb0a147844cac72fd7295a79c00b cũng sửa AGENTS.md và CLAUDE.md so với main này. G0 không merge/copy toàn nhánh docs; khi tích hợp sau này cần reconcile hai delta, giữ Next rules, governance A/B/C mới và hướng dẫn module còn phù hợp. Không dùng slot-for-every-task cũ để khôi phục yêu cầu slot cho A hoặc bỏ shared/production gates B/C. Đây là integration risk được ghi nhận, không quyền merge trong G0.

G0 AC: đủ A/B/C và task/review/evidence protocol; A không xin slot từng task; B single-writer/ownership/dependency rõ; C không vượt quyền; skill hết repo/path cũ và auto-merge/admin bypass/dirty carry/bulk stage; CLAUDE phản ánh package/source hiện tại; template không điền PASS giả. Local checks: exact five paths, reference links, UTF-8/whitespace/conflict kể cả untracked, preservation Next block và ngoài allowlist, hashes/index. Bàn giao UNSTAGED cho Claude 2; sau PASS mới commit/push/Draft PR vào main, xác minh remote và theo dõi CI thật, không merge.

Dependencies G0 chỉ gồm yêu cầu PO, exact origin/main và instructions/source đối chiếu tại ref đó; không cần CMS M1, Product compatibility hoặc Audience Physical hoàn tất. Registry/source của các lane giữ riêng. Điều kiện milestone công bố: Claude 2 PASS đúng năm-file checkpoint, commit/push/Draft PR đã xác minh và CI state có evidence thật; CI chưa chạy không được ghi SUCCESS.

| AC G0 | Validation / negative review case |
|---|---|
| G0-01 roles / autonomy | Đối chiếu matrix và A/B/C; task A đủ contract đi hết vòng review/CI không xin slot. Không suy mọi pure task là A nếu chạm shared contract/path. |
| G0-02 shared / high risk | Kiểm single-writer và release/receive/dependency/effectiveness. Review tình huống hai owner sửa schema hoặc merge main bằng quyền tạo PR: phải từ chối ngoài quyền, không thực hiện hành động để thử. |
| G0-03 review integrity | Kiểm FAIL/fix/regression/PASS và revision chain; source đổi, author tự ghi Claude PASS hoặc mirror không hash không được coi là reviewed original. |
| G0-04 publication skill | Inspect skill/frontmatter: correct repo, exact-path stage, dependency-base Draft, idempotency và CI; không còn executable auto-merge/admin fallback/dirty carry/branch deletion. |
| G0-05 source / PR evidence | Đối chiếu CLAUDE với package/source/workflows thật; template chứa đủ reviewer/author/CI/DB/OPEN/release fields và default NOT_REVIEWED/NOT_STARTED/NOT_RUN, không fake PASS. |
| G0-06 preservation / docs | Kiểm đúng năm paths, Next block nguyên vẹn, local links, strict UTF-8/whitespace/conflict cả untracked, index rỗng và fingerprints; không source/schema/workflow/registry delta hoặc thay checkpoint đang review. |

Branch protection **NOT_VERIFIED**: Integrator thử GET branches/main/protection, connector trả 403 Resource not accessible by integration. GET repository rulesets trả danh sách rỗng tại lượt kiểm; không suy từ đó main không được bảo vệ. PO kiểm Settings -> Branches/Rules -> Rulesets với quyền quản trị: effective protections/bypass actors, required review/status checks, force-push/deletion và release authority; ghi evidence, không tự thay cấu hình trong G0.

G1 **PROPOSED / NOT_STARTED**: task B riêng để thêm CI kiểm task/PR evidence và allowlist/fingerprints, kiểm docs/instructions/unsafe merge patterns; chốt exact workflow/script/test paths và ownership trước code. Kiểm positive/negative controls, giữ validate mode/checkout provenance và candidate/deploy separation; không coi presence của chữ Claude PASS là independent review được xác thực. Branch protection/rulesets và release gates cần PO đối chiếu quyền/thiết lập riêng. Không sửa CI/protection trong G0 hoặc bắt các lane đang chạy chờ G1.
