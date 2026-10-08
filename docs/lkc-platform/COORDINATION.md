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
| CMS — Codex số 1 | CMS-011.0; feature/cms-011-review-policy / f909aa3f5eca7ed56ed7337853ad6252f1ccb419; PR #30; base 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c | Checkpoint pure implementation: Claude PASS / CI SUCCESS do PO chuyển; CMS-011.0 SLOT_GRANTED, vẫn giữ qua handoff/review, chưa giải phóng | Đúng ba create paths CMS tại quyết định bên dưới; modify none; không schema/runtime slot | CMS_OWNER_SCOPE_ACK lịch sử và CMS consumer semantic ACK C01/C02 mới do PO chuyển ngày 08/10/2026; chi tiết checkpoint bên dưới |
| Portal — Codex số 2 | SUB-002.0; feature/product-catalog-policy dự kiến, chưa tạo; base main 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c; task/docs PR #31 / a0e8e6d7f4b41ba417783e751f6d13daee90992c | SLOT_GRANTED, hiệu lực theo mốc công bố bên dưới; chưa source/tests tại checkpoint cấp slot | Đúng ba create paths Product bên dưới; modify none | PORTAL_OWNER_SCOPE_ACK do Codex số 2 ghi đúng phạm vi giao; không ACK schema/runtime |
| Integrator — Codex số 2, phiên Codex Portal này | SUB-001 / CMS-011.0 / SUB-002.0; docs/sub-001-cms-011-slot; parent delta mới 18bac5cf6729a1e8c3a1d96b0a4e8981fcb2ead0 | PO_ASSIGNED; CMS slot giữ nguyên; Claude PASS delta Product do PO chuyển, công bố slot Product | Registry; không claim source CMS hoặc shared schema/library/runtime | PO tiếp tục giao vai trò và chuẩn bị/công bố slot Product; Claude review độc lập đúng delta mới |

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

### Checkpoint bổ sung SUB-001 / SUB-002.0 — 08/10/2026 (UTC+7)

Đây là quyết định **SLOT_GRANTED** cho Product trên parent registry `18bac5cf6729a1e8c3a1d96b0a4e8981fcb2ead0`. Mốc DRAFT_LOCAL / WAITING_CLAUDE_REVIEW là lịch sử; Claude PASS delta đúng fingerprint đã được PO chuyển. Slot Product có hiệu lực khi commit chứa quyết định này đã push và draft PR #29 đã cập nhật công bố đúng head; trước hai mốc này bản local chưa có hiệu lực. Chưa tạo source/tests tại checkpoint cấp slot. Cập nhật sau review chỉ là trạng thái hành chính/mốc hiệu lực, không đổi scope/ACK/policy. Các entry CMS cũ ở trên là mốc lịch sử; checkpoint mới không đổi quyền/path/điều kiện giữ slot CMS-011.0.

| Bằng chứng tiếp nhận | Provenance và boundary |
|---|---|
| CMS-011.0 | PO chuyển [PR #30](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/30), head f909aa3f5eca7ed56ed7337853ad6252f1ccb419, Claude PASS và CI run 37774160039 SUCCESS. Integrator đọc metadata/diff filenames remote: OPEN/DRAFT, đúng ba create paths CMS, base main 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c. Không review lại spec/tests/CI, không nhận đã trực tiếp kiểm máy CMS. Slot CMS-011.0 vẫn giữ; không tự cấp slot CMS-011.1/schema. |
| Portal docs | [PR #31](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/31), head a0e8e6d7f4b41ba417783e751f6d13daee90992c; Claude PASS do PO cung cấp, CI run 37774769201 SUCCESS đã kiểm trong checkpoint công bố. Bốn docs immutable giữ nguyên; mapping không là tests runtime. |
| C01 consumer ACK | PO chuyển xác nhận của Codex số 1 đối với C01 v0.1 tại docs commit a0e8e6d7f4b41ba417783e751f6d13daee90992c: identity/DTO, new-selection/retained-reference, server revalidation, safe errors và catalog revision. Không có semantic conflict trong scope này theo ACK đã chuyển. Không là ACK physical schema, authoritative producer runtime hoặc retained-name API. |
| C02 consumer ACK | PO chuyển **CMS_CONSUMER_SEMANTIC_ACK** của Codex số 1 với C02 v0.1 tại cùng docs commit: server trust, Product OR, ba nhóm cùng quyền, fail closed, decision không body; vẫn kiểm publication/audience/context. Reader runtime tương lai chưa READY; C02 không được tiêu thụ trong SUB-002.0 hoặc CMS-011.0. |
| L1/L2 và OPEN | L1: hai owner thống nhất capability không tạo paywall theo tab khi Product còn quyền, vẫn kiểm từng content/publication/audience; không ghi finding tài liệu CLOSED vì chưa sửa/review câu chữ. L2: retained Product display và resubmit/approve Product đã retire vẫn OPEN. C03/C06 physical schema/runtime, term/grace/refund và self-approval chưa READY. C01/C02 docs v0.1 là bản PROPOSED_FOR_ACK lịch sử; registry ghi nhận ACK semantic mới, không biến toàn contract thành runtime READY. |

#### Đề nghị slot SUB-002.0 — pure Product catalog policy/DTO

Codex số 2 ghi **PORTAL_OWNER_SCOPE_ACK** cho đúng scope dưới đây trong vai trò owner Portal; vai trò Integrator tiếp nhận đề nghị và kiểm overlap, nhưng không thay Claude review delta điều phối mới. PO đã giao tự công bố sau PASS và tiếp tục implementation trong cùng nhiệm vụ khi slot có hiệu lực; không cần giao lại hoặc xin lại phép commit/push/PR/CI.

| Hạng mục | Đề nghị / điều kiện |
|---|---|
| Task / owner / reviewer / Integrator | SUB-002.0 (subtask SUB-002); Codex số 2 — Portal; Claude independent; Integrator là Codex số 2. Task và bảy PCAT AC tại [SUB-001-PORTAL.md đúng commit](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/a0e8e6d7f4b41ba417783e751f6d13daee90992c/docs/lkc-platform/tasks/SUB-001-PORTAL.md). Không code Billing/Entitlements/Referral/REC đồng thời. |
| Branch / base | feature/product-catalog-policy dự kiến, chưa tạo tại kiểm này. Main local/remote đối chiếu vẫn 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c. Trước nhận implementation kiểm lại main/path/claim và ghi base SHA; drift ảnh hưởng boundary phải xử lý trước code, không tự merge docs. |
| Create paths duy nhất | `src/features/products/product-catalog-contract.ts`; `src/features/products/product-catalog-policy.ts`; `tests/product-catalog-policy.test.mjs`. Modify paths: **không có**. |
| Contract scope | Feature-local pure DTO/validation/policy cho C01 semantic đã ACK: Product khác ProductPlan/FinancialInstrument, rename giữ identity; năm Product × ba nhóm bằng fixtures; input thiếu/rỗng/sai/duplicate/unknown/non-selectable safe errors; sale stopped không tự revoke; retained policy OPEN trả unresolved; producer unavailable không empty-success/PUBLIC fallback; CMS DTO metadata allowlist. Validation chỉ trên DTO/fixtures được cung cấp, không authoritative lookup/persistence/transaction guarantee. |
| Exclusions | Không DB/network/filesystem/side effects trong pure functions; không production fake catalog/seed; không import chéo feature implementation cho consumer. Không src/lib/contracts/shared library, schema/migrations, CMS source/writer/media, auth/roles, routes/UI/PortalShell, harness, workflow/package hoặc dữ liệu thật. C02 reader, webhook/quant và commercial/retained-name API không thuộc slot. |
| Kiểm overlap | Integrator kiểm ba worktree đăng ký local: main, Portal docs và registry đều sạch trước delta; không có ba Product paths. Local/remote chưa có branch Product; tìm PR theo head Product không có kết quả. Registry và PR #30 có path CMS tách biệt, không claim trùng Product; quyền CMS giữ nguyên. Không suy không có PR thành không có local work; không kiểm mọi máy/clone ngoài ba worktree này. Nếu có claim/path mới xuất hiện thì dừng boundary và phối hợp owner. |
| Dependency trực tiếp | Main/base đã đối chiếu + task/C01 ở a0e8e6d7f4b41ba417783e751f6d13daee90992c/PR #31 + PORTAL_OWNER_SCOPE_ACK + CMS C01 semantic ACK do PO chuyển + quyết định slot Product công bố sau Claude PASS. Không bắt chờ toàn CMS/Billing/Entitlements/REC; shared adapter/schema cần slot riêng khi task sau thực sự dùng. |
| Review / mốc hiệu lực | Delta này chỉ COORDINATION.md UNSTAGED cho Claude review phần mới. Sau PASS, Integrator cập nhật trạng thái hành chính thành SLOT_GRANTED, commit/push trên branch registry hiện có và cập nhật draft PR #29 vào docs/lkc-platform-ui-v3-coordination. Slot Product chỉ có hiệu lực khi commit quyết định đó đã push và PR #29 đã công bố cập nhật đúng head; bản local chưa có hiệu lực. Không cần merge docs; CI registry không tự thành điều kiện chặn slot. |
| Handoff implementation | Đúng ba files UNSTAGED cho Claude; branch/base/HEAD, immutable registry SHA cấp slot, fingerprints, bảy PCAT AC mapping, focused happy/negative tests, scoped lint, TypeScript và diff-check thực chạy trong môi trường dummy. Dùng Node phù hợp repo và báo phiên bản/giới hạn. Báo cáo trong phản hồi, không file thứ tư. Không chạy DB/staging/production/full browser; sau implementation Claude PASS mới commit/push/draft PR/CI theo quyền thường trực. |
| Giữ / giải phóng slot | Slot Product giữ qua vòng implementation/review nếu phạm vi không đổi. Integrator ghi handoff/release hoặc slot tiếp sau xác nhận diff/test/review và boundary; không tự giải phóng theo thời gian, tạo file hoặc mở PR. Thay paths/scope/shared dependency cần cập nhật quyết định. Slot CMS độc lập vẫn giữ, không bị Product slot thu hồi. |

Không thay các quyết định OPEN để viết tests PASS; chưa authoritative Product producer runtime, stable-ID persistence hoặc transaction. Không ghi SUB-001/SUB-002 COMPLETE. Manual authenticated production UAT tiếp tục **DEFERRED đến cuối dự án**.

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
