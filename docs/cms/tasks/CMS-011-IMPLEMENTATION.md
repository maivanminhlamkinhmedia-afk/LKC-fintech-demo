# CMS-011 — Handoff implementation theo bước nhỏ

Trạng thái: PLAN_DRAFT, 08/10/2026. Companion: CMS-011.md. Chỉ là tài liệu trong worktree riêng từ main 5e6b14f006453da7f9b1554c210e9ad85a9f8c0c; không có source/schema/tests được sửa trong lượt này. PR tài liệu UI v3 #27 head 9e627f94080322f59df990734ae2739a6e344cb6 đang DRAFT, đọc bằng ref; không xem là migration/code dependency đã merge.

## Checkpoint nguồn thật

- package.json có test:unit = node --test tests/*.test.mjs, Playwright discovery và guarded staging runner. Câu “No test runner” trong CLAUDE.md legacy không còn đúng.
- src/lib/roles.ts đã có cms:article:submit/review/approve nhưng hiện chỉ SUPER_ADMIN/ADMIN có review/approve; CREATOR submit own. article-draft-actions.ts dùng fresh actor, Serializable, CAS Article.updatedAt, persisted token. Các writer source/classification/cover cùng tranh token. article-autosave.ts điều phối manual/auto single-flight; không thêm action riêng bỏ qua controller.
- ArticleVersion hiện có body/title/excerpt nhưng thiếu audience, slug, source/classification/cover snapshot và quan hệ approval/published pointer; ArticleReview không có versionId. Product/Subscription chưa có. Preview query đọc raw Article đã lưu cho CMS staff, không thể dùng làm public published view.
- Manifest v4/runner hiện kiểm 19 counters của graph CMS-009/010. Nếu thêm version/review/edges/events thì 19 không đủ; phải thiết kế journal/recovery/cleanup mới trước khi chạy browser staging.
- Roadmap CMS giữ CMS-011 Editorial review, CMS-012 fact-check/request changes, CMS-013 revision history, CMS-015 publish/schedule/unpublish; CMS-ACCESS-001.A/B/C là task tích hợp, không đổi số CMS.

## Contract gửi Integrator tại SUB-001

Mọi shape/signature bên dưới là **PROPOSED**, không là API hiện có. CMS owner ACK chỉ có khi owner xác nhận riêng; bảng bên dưới hiện chưa ghi nhận ACK của CMS, Portal, Media hoặc Integrator và không ghi READY vào COORDINATION. Exact names, model FK/index, error union và version số phải được owner ký nhận trước implementation chung. Các port chỉ chạy server-side; actor/time lấy từ server.

| ID, producer → consumer | Shape/signature đề xuất và nguồn authoritative | Revision/token, safe failure, dependency, contract tests |
|---|---|---|
| C01 Products → CMS/REC/Billing | getSelectableProducts({cursor,limit}): {catalogVersion, items:[{id,name,selectableForContent}]}; validateArticleProducts(ids): validated stable IDs. Product.id/trạng thái do Portal Product model giữ; CMS lưu references, không chép catalog. Không dùng Plan/checkout làm Product identity. | Product catalogVersion chỉ hỗ trợ stale UI; Article.updatedAt CAS quyết định save. UNKNOWN/retired/unavailable → PRODUCT_INVALID hoặc PRODUCT_UNAVAILABLE, không tự PUBLIC. Sau SUB-001 C01 + SUB-002 producer commit; contract tests: stable IDs, disabled/retired policy, duplicates, empty PAID, outage, changed catalog giữa load/submit. |
| C02 Subscriptions → CMS/REC reader | decideContentRead({serverActor,requiredProductIds,atServer,capability}): {allow,reason}; Product IDs OR. User và clock lấy từ server; Subscription/Period/Revoke authoritative ở Portal. CMS-011 chỉ ghi shape và test double, **không tiêu thụ trong action review**. | Entitlement revision/asOf nếu producer hỗ trợ; không lưu paid flag trên User/Article, không tin token client. Deny cho guest/expired/revoked/outage, không trả body. Phụ thuộc SUB-004/C02 ACK trước CMS-016/019 paid reader; tests contract đúng endsAt, revoke, product B, outage và no-body serialization. |
| C03 CMS approval/publishing → reader/media/Portal | CMS-011 đề xuất resolveApprovedSnapshot({articleId,expectedVersionId,expectedArticleUpdatedAt}) cho CMS-015: {versionId,versionNumber,basisUpdatedAt,approvalId,accessMode,productIds,body,metadata,assetIds}. Sau CMS-015, resolvePublishedPolicy({articleIdOrSlug}) chỉ trả policy/version/public metadata an toàn, còn readPublishedVersion({versionId,authorizedDecision}) mới trả body server-side. ArticleVersion + version edges + typed ArticleReview + Article pointers là authoritative; Article raw chỉ working copy. | versionId là immutable revision; Article.updatedAt là CAS working token; activeApprovalVersionId khác publishedVersionId. STALE_APPROVAL/NOT_PUBLISHED/FORBIDDEN/UNSUPPORTED_VERSION/INTERNAL_ERROR fail closed. CMS-011 tạo snapshot và approval link; CMS-013 chốt bất biến/history/correction; CMS-015 ghi pointer atomically; CMS-016 tiêu thụ. Tests: change body/audience invalidates active approval, published v1 không đổi khi draft v2, publish wrong version fails, no body from policy/Flight/cache. |
| C06 CMS/REC content → Media | assertVersionAssetReferences({articleId,versionId,assetIds,context:'review'|'published'}): validated asset IDs/integrity; listVersionAssetRefs(versionId) cho delete-used guard. MediaAsset/object receipt authoritative về bytes; CMS giữ version→asset edge và quyền Article; hiện cover là tham chiếu rõ, không giả định editor hỗ trợ inline image. | versionId gắn reference bất biến; asset mutable metadata không được âm thầm đổi snapshot. MISSING/FOREIGN/CORRUPT/UNAVAILABLE fail closed; không trả raw filesystem path. CMS/media owner + Integrator ACK, trước snapshot/published reader; tests foreign asset, deleted-used guard, historical version retain, cover context, exact fixture cleanup. |

Trạng thái ACK tại checkpoint này (không sửa registry chung):

| Contract | Vị thế trong tài liệu CMS này | ACK chính thức của CMS owner | ACK producer/consumer khác | Integrator READY |
|---|---|---|---|---|
| C01 | CMS consumer proposal; Product ID authoritative ở Portal | CHƯA GHI NHẬN | Portal Products: CHƯA GHI NHẬN | CHƯA |
| C02 | CMS reader consumer proposal cho CMS-016+, chưa dùng ở CMS-011 | CHƯA GHI NHẬN | Portal Subscriptions: CHƯA GHI NHẬN | CHƯA |
| C03 | CMS producer proposal về version/approval/published pointer | CHƯA GHI NHẬN | Portal reader và Media: CHƯA GHI NHẬN | CHƯA |
| C06 | CMS content/version reference proposal | CHƯA GHI NHẬN | Media owner/REC: CHƯA GHI NHẬN | CHƯA |

Người soạn spec không thay chữ PROPOSED bằng ACK thay CMS owner hoặc owner khác. Reviewer cần nhận đúng stable Product IDs của snapshot; nếu cần nhãn lịch sử, version edge đề xuất giữ nameAtSubmission chỉ để hiển thị, không dùng nhãn đó thay Product ID hoặc trạng thái hiện tại. Chính sách nhãn này cần C01/C03 ACK.
C03 cần quyết định vật lý **trước** CMS-011 submit action: Article nullable accessMode + ArticleProduct working edges; ArticleVersion mở rộng cột metadata/audience và các version edge có kiểu cho Product/Source/Classification/Media; Article.activeReviewVersionId/activeApprovalVersionId; ArticleReview.versionId; workflow event typed. Article.publishedVersionId dành CMS-015. Không giấu audience, Product IDs hoặc version ID trong JSON/comment để tránh join và integrity checks. Nếu FK vòng gây khó migration, Integrator có thể chốt pointer table có unique Article ID với cùng semantics; task không tự chọn workaround. ArticleVersion chỉ append, index (articleId, versionNumber) đã có; các FK/onDelete Restrict và index versionId/articleId phải được preflight. current Article.updatedAt DATETIME(3) vẫn là shared CAS; không dùng timestamp của review event thay token.

C03 qua các milestone: CMS-011 submit tạo immutable review snapshot v1; approve gắn typed version FK và active pointer. CMS-013 không tạo loại version thứ hai mà hoàn thiện history/correction/invalidation. CMS-015 chỉ publish/schedule đúng approved version, ghi published pointer/event trong transaction và giữ snapshot cũ khi draft mới mở. CMS-016/019 chỉ consume published policy + authorized body, không raw Article. C02 chưa cần cho CMS-011 nội bộ; không phụ thuộc Portal hoàn thành Billing/checkout để đề xuất pure policy; mọi bước code vẫn cần Integrator ghi scope/slot, nhưng không bật paid reader khi C02 chưa có. C01 thật cần trước production submit PAID; draft UNCONFIGURED vẫn lưu.

| Câu hỏi cần Integrator/owner chốt | Phía CMS đề xuất; trạng thái |
|---|---|
| Shared schema/migration + writer slot, thứ tự PR | Integrator giữ một slot schema, mở migration expand-compatible trước consumer. CMS đề xuất, WAITING_ACK. |
| Product chọn/retire policy, source port C01 | Portal Products producer; CMS consumer đề xuất, WAITING_PORTAL_ACK. |
| Self-approval và điều kiện nhận review | Đề xuất không tự duyệt bài mình và bắt buộc TAKE trước APPROVE; cần PO/Integrator ACK, không sửa role matrix ngầm. |
| Source/classification/cover/SEO có trong approved version | Có: tất cả dữ liệu có thể ra ngoài là cùng snapshot; exact edge model/retention cần CMS+Media+Integrator ACK. |
| Revision sau approval, published pointer, rollback mixed-version | Clear active approval atomically khi content/audience đổi; published pointer cũ vẫn giữ. Migration compatibility/feature gate chốt trước code. |
| Asset delete-used và C06 | Version reference giữ asset cũ; owner Media ACK. |
| Event/audit typed và C07 | Workflow event cho SUBMIT/TAKE/APPROVE; audit/event consumer sau cần C07 ACK, không làm Billing dependency. |

## Các PR nhỏ, không xây lại portal

Mỗi bước có branch/PR riêng khi được giao; số PR và SHA implementation hiện **TBD**. Không có bước nào tự miễn điều phối vì chỉ tạo file mới, là pure policy/DTO, dùng test double hoặc chưa sửa schema: Integrator phải ghi nhận owner, phạm vi path và slot áp dụng trước khi bắt đầu code. Base tối thiểu là main 5e6b14f…; trước khi code phải fetch main thực tế và ghi dependency SHA đã merge. UI docs #27 được tham chiếu bằng head cho tới khi Integrator phối hợp merge docs (push main tự deploy), không cherry-pick toàn PR vào source branch.

| Bước | Outcome và dependency commit/PR | Allowed paths; forbidden/shared-file slot | AC và tests |
|---|---|---|---|
| CMS-011.0 — pure policy/DTO | Có transition table, safe errors, version/audience DTO với test doubles; độc lập với Product implementation, chỉ là đề nghị giao sau SUB-001, CMS owner ACK phạm vi và Integrator ghi slot; trạng thái hiện WAITING_ACK/WAITING_SLOT. Depends: main hiện hành + C03 semantics ở mức proposal được Integrator chấp nhận cho pure tests; không production route. | Requested exact create paths: src/features/cms/article-review-contract.ts; src/features/cms/article-review-policy.ts; tests/cms-article-review-policy.test.mjs. Requested modify paths: none. Forbidden: schema/migrations, shared contract library, roles/auth, Article writer, media, harness, workflow, routes/Portal. Hai path article-review-* vẫn nằm trong vùng CMS article-* cần Integrator ghi nhận scope/slot; file mới không tự cấp quyền. | AC-01..04, 06..08, 16, 21, 26; focused pure tests RBAC/status/invalid input/unknown result. |
| CMS-011.1 — nền schema/revision | Integrator chốt C03/C06 và triển khai migration expand-compatible + typed FK/edges; không backfill PUBLIC/APPROVED. Depends: SUB-001 ACK C01/C03/C06 + slot schema, SUB-002 Product model producer commit (nếu tạo ArticleProduct FK), base main mới và CMS-011.0 reviewed. Nếu Product chưa merge, chỉ tách migration version/review không chứa Product FK sau khi Integrator xác nhận một split tương thích; không tạo bảng Product giả. | Allowed khi được cấp slot: prisma/schema.prisma, migration mới, version serializer/server contract files mới, schema tests. Forbidden: sửa migration cũ, billing/product tables tự tạo, public route, deploy workflow. Shared: schema/migrations/contract library do Integrator ghi owner. | AC-09..12, 17..19, 25, 27; migration preflight, FK/index/onDelete, mixed-version/rollback, snapshot immutability tests. |
| CMS-ACCESS-001.A — audience trong writer hiện hữu | Lưu nullable audience và Product mappings qua **cùng** create/update/autosave/CAS, không writer thứ hai. Depends: C01 ACK + SUB-002 Product producer commit cho production selection, CMS-011.1 schema; test doubles chỉ được code sau khi Integrator ghi phạm vi/slot phù hợp; không bật production selection trước producer ACK. | Allowed sau claim: article-draft.ts/actions/query, ArticleDraftForm, article-autosave.ts, Product option adapter + focused tests. Forbidden: role matrix, checkout, subscription, unauthenticated reader. Shared: toàn Article writer/form với CMS owner. | AC-05..08, 18, 21..24, 26; focused controller/action/form/Flight, conflict/offline/lost ACK, product outage. |
| CMS-011.2 — submit + queue | Chụp snapshot persisted và event atomically; reviewer queue scoped, stable pagination. Depends: .1 + .A merged SHA, C03/C06 ACK và actor policy. | Allowed: new article-review-actions/query, thin creator review route/components, focused tests; edit Article writer chỉ sau renewed slot nếu thật cần. Forbidden: publish/schedule, request changes/fact-check, public feed. Shared: Article lifecycle/route and version helpers; record claim. | AC-01..15, 20..24, 29..30; transaction rollback, concurrency, scope, UI pending/save, queue pagination tests. |
| CMS-011.3 — TAKE/APPROVE + history | Reviewer thấy snapshot audience, nhận việc, approve đúng version, append-only event/history. Depends: .2 merged SHA, self-approval decision ACK. | Allowed: review actions/query/components, version-bound ArticleReview/event writes, tests; schema delta chỉ qua Integrator slot riêng. Forbidden: CMS-012 decision REQUEST_CHANGES/FACT_CHECK, CMS-015 publish/publishedAt, public reader. Shared: Article status/approval pointer. | AC-13..26, 30; same-version CAS, competing reviewers, stale approval, no publication, safe history tests. |
| CMS-011.4 — guarded E2E/harness | Journal new version/review/event/product/version-asset graph, exact cleanup and browser scenarios; không chạy staging cho tới review/CI và lease. Depends: .1–.3 reviewed and merged, C06 media owner test contract. | Allowed: scripts/cms-e2e fixture/guard/diagnostics/cleanup, tests/e2e/cms-review.spec.ts, harness tests, runbook/report. Forbidden: broad cleanup, production root, manual DB writes, timeout/retry inflation. Shared: harness with CMS/media owner. | AC-01..30; REV scenarios, baseline 141 regressions, count cleanup graph thực đo, negative ownership. |

Task nhỏ đầu tiên **đề nghị** giao sau SUB-001 là CMS-011.0; WAITING_ACK/WAITING_SLOT cho tới khi Integrator ghi nhận đúng ba path, owner và ranh giới không tích hợp runtime. Không cần hoàn thành toàn bộ portal, nhưng không được viết pure files hay tests chỉ vì chưa đụng schema/writer. Nếu C01 producer chậm, CMS-011.0 vẫn có thể triển khai sau khi CMS owner và Integrator đã ACK semantic scope/slot của bước đó; khi chưa có slot thì chỉ tiếp tục đọc/spec. Từng PR review-neutral hay contract test khác cũng phải có scope/slot riêng được ghi nhận. Không bật audience PAID thật hoặc submit thiếu policy. Mỗi bước kết thúc với diff UNSTAGED cho Claude independent review, rồi commit/CI/staging theo checkpoint riêng; không suy tài liệu này đã cấp quyền migration.

### Đề nghị slot CMS-011.0 gửi Integrator — WAITING_ACK / WAITING_SLOT

Đề nghị này chưa phải claim. Bảng COORDINATION/DECISIONS của PR #27 không được sửa trong lượt này; không ghi CLAIMED, READY hoặc giả định owner khác đã nhường vùng. Vì hai file mới dự kiến nằm trong vùng src/features/cms/article-* của quy tắc phối hợp, cần Integrator ghi slot dù diff chỉ tạo file mới.

| Hạng mục | Đề nghị chính xác |
|---|---|
| Actor/owner và reviewer | CMS owner xác nhận actor nhận việc, branch/base HEAD và đồng ý ranh giới pure policy; Integrator kiểm overlap, ghi path set/slot và dependency trong registry; Claude independent reviewer kiểm diff theo scope sau implementation. Chưa có tên actor/ACK được ghi tại checkpoint này. |
| Create paths duy nhất | src/features/cms/article-review-contract.ts; src/features/cms/article-review-policy.ts; tests/cms-article-review-policy.test.mjs. Modify paths: **không có**. Nếu path đã xuất hiện trên base mới hoặc owner khác claim, dừng và xin Integrator đổi scope trước code. |
| Shared/runtime integration bị loại | Không sửa prisma/schema.prisma, migrations, src/lib/contracts/**, src/lib/roles.ts, src/lib/auth.ts, src/lib/authz.ts, các file src/features/cms/article-draft*, article-autosave.ts, ArticleDraftForm, source/classification/cover/media, src/app/**, scripts/cms-e2e/**, workflow/package. Không nối module mới vào action, route, database hoặc UI; không tạo public API/producer port thật. |
| Contract/decision thật sự cần | C03 **semantic proposal**: revision/version identity, transition và safe error union để viết pure policy tests; CMS owner + Integrator cần ACK phạm vi này trước code, không coi đó là C03 physical schema READY. C01 chỉ có placeholder audience/ID trong DTO, không gọi Product; C02 và C06 không tiêu thụ. Quyết định self-approval, FK/schema, Product retire policy và C01/C02/C06 owner ACK vẫn WAITING_ACK cho bước sau; pure tests không được chốt thay. |
| Điều kiện nhận slot | CMS owner gửi checkpoint task/branch/HEAD/base, dirty/staged paths, đúng ba create paths, expected contract version và file overlap. Integrator xác nhận owner khác không giữ path/vùng, ghi slot áp dụng với thời điểm/phạm vi và dependency SUB-001; sau đó mới giao implementation. Trước mốc này chỉ đọc, sửa spec hoặc review; không tạo source/tests. |
| Handoff và giải phóng | Sau implementation: giao exact diff, fingerprint, focused test evidence và Claude review; Integrator xác nhận không có shared/runtime path ngoài slot, ghi bàn giao/giải phóng hoặc cấp slot kế tiếp. Slot không tự giải phóng theo thời gian, khi mở PR hay khi file mới đã tạo. |

Finding LOW: CMS-011.0 và CMS-011.3 không có decline/request-changes path là giới hạn có chủ đích. CMS-012 sở hữu REQUEST_CHANGES/fact-check; enum REJECT hiện có không được dùng để thêm transition mới ở checkpoint này.
## AC → test kế hoạch (chưa chạy)

Tên tests dưới đây là **đề xuất file/case**, chưa tồn tại. P=policy/DTO unit, A=action/transaction, Q=query, F=form/controller, H=harness, B=guarded browser. REV là scenario mới; số browser registrations thực tế đếm bằng discovery, không cố định tổng.

| AC | Test cụ thể |
|---|---|
| 01 | P01 guest/CLIENT/ANALYST deny; B REV-01 protected direct routes/Flight no body |
| 02 | P02 CREATOR own/admin any; Q01 scoped list; B REV-02 foreign ID |
| 03 | A01 actor disabled/role changed before transaction |
| 04 | P03 transition table; A02 wrong-state submit |
| 05 | F01 pending autosave + late ACK; B REV-03 submit persisted bytes |
| 06 | A03 NULL audience saves, submit fails; B REV-04 unconfigured draft |
| 07 | P04 PAID empty/duplicate/product OR; A04 persisted mapping |
| 08 | A05 Product missing/retired/outage; B REV-05 fail closed |
| 09 | A06 full snapshot content/metadata/edges, source mutation afterward unchanged |
| 10 | A07 concurrent CAS and persisted DATETIME(3) ACK |
| 11 | A08 injected failure per version/edge/event/status write rolls back |
| 12 | A09 two submits + lost ACK scope/version lookup; B REV-06 |
| 13 | Q02 reviewer sees version audience, not changed working row; B REV-07 |
| 14 | Q03 pagination/status/scope/cursor; B REV-08 multiple pages |
| 15 | A10 two reviewers TAKE race, one winner; B REV-09 |
| 16 | A11 approve exact state/version, publishedAt unchanged; B REV-10 |
| 17 | A12 typed review version FK and actor, immutable history |
| 18 | A13 all writer paths invalidate active approval; B REV-11 change audience/body |
| 19 | A14 stale version publish contract negative; Q04 published v1 vs draft v2 |
| 20 | Q05/Flight denied serialization; B REV-12 private notes/body |
| 21 | F02 unknown result no retry/token refresh; A15 conflict unchanged |
| 22 | A16 expired session after dispatch safe failure; F03 input retained |
| 23 | F04 offline/IME/dirty navigation/manual-auto single flight; baseline AUTO-21 |
| 24 | A17 committed write + failed revalidate returns warning/success |
| 25 | Q06 event ordering/actor/version/scope; B REV-13 history |
| 26 | P05 no new role/catalog/paid flag; schema diff assertion |
| 27 | H01 migration preflight/mixed-version/NULL backfill; no DB run in spec stage |
| 28 | H02 journal/recovery/ownership/negative cleanup graph; B REV-14 guarded cleanup |
| 29 | B discovery baseline 141 + N REV, then full browser execution on reviewed head |
| 30 | F05 keyboard/focus/mobile/error/empty; B REV-15 screen 15 states |

Contract tests C01/C02/C03/C06 additionally cover producer unavailable, invalid Product, approved/published revision separation, media historical refs. B REV-14 is only a proposed scenario and cannot certify cleanup without runner counters/exit/VERIFIED on actual staging. Tests for CMS-012 fact-check/request changes, CMS-013 full revision UI, CMS-015 scheduling/publication and CMS-016 paid reader remain separate tasks.

## Validation/QA plan khi code được giao

Local subprocess phải lọc môi trường, dùng dummy DATABASE_URL/auth, không đọc .env hoặc staging credential. Theo phạm vi từng PR: focused unit/action/contract, full unit/action khi source chung đổi, Prisma validate/generate nếu schema đổi, lint, TypeScript, isolated build khi app/schema đổi, Playwright discovery, diff-check. Node version và test counts lấy từ run thực, không chép mốc cũ. Sau Claude review/CI, guarded staging có runId/BUILD_ID/head mới, fixture journal/cleanup exact graph và baseline 141 + REV registrations thực; không hard-code 19 counters. Browser staging, CI và tất cả tests CMS-011 hiện NOT RUN.

Không SSH, DB thật, staging, fixture/cleanup thật, production writes, commit/push/PR/merge/deploy trong lượt soạn spec. Manual authenticated production smoke/UAT DEFERRED đến nghiệm thu cuối dự án theo PO; không ghi PASS.
