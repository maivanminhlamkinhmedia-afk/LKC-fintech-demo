# IMPLEMENTATION REPORT — CMS-005

Ngày: 2026-09-24. Trạng thái: **IMPLEMENTED LOCAL — chuyển Claude independent review**.
CMS-005 chưa COMPLETE; CI, staging, merge/deploy và production smoke chưa thực hiện.

## 1. Repository và phạm vi

- Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`.
- Branch: `feature/cms-005-draft-editor-tiptap`.
- HEAD bắt đầu và kết thúc: `affa9540b46cc7d22001c78376573c8609d47692`.
- Working tree ban đầu sạch; kết thúc có các thay đổi chưa stage được liệt kê bên dưới.
- Source of truth đã đọc đầy đủ: `AGENTS.md`, `docs/cms/ROADMAP.md`, `docs/cms/tasks/CMS-005.md`, `docs/cms/tasks/CMS-005-IMPLEMENTATION.md`.
- Đã đọc schema/migration hiện có, các policy/auth/query/action/test liên quan và tài liệu Next cài trong `node_modules/next/dist/docs/` về Server Actions, server/client boundary, errors, params và revalidation.
- Local runtime thực tế: Node **24.19.0**, npm **11.17.0**. Không thay runtime; CI vẫn dùng Node **22**. Kết quả local không được coi là bằng chứng CI Node 22 đã chạy.

Đã triển khai list/new/edit, TipTap lưu thủ công, scoped server actions, validation document, optimistic concurrency, navigation/dashboard integration, unit/action/route tests, CI unit-test step và Playwright staging foundation/runbook.

## 2. Dependency metadata gate

Đã kiểm tra đủ năm lệnh trước khi sửa package files:

```powershell
npm.cmd view @tiptap/core@3.31.3 version peerDependencies engines --json
npm.cmd view @tiptap/react@3.31.3 version peerDependencies engines --json
npm.cmd view @tiptap/pm@3.31.3 version peerDependencies engines --json
npm.cmd view @tiptap/starter-kit@3.31.3 version peerDependencies engines --json
npm.cmd view @playwright/test@1.63.0 version peerDependencies engines --json
```

Các lần đầu trong sandbox lỗi EACCES; retry bằng quyền network cho riêng thao tác đọc metadata đã trả exit 0 cho cả năm package. Không cài package trước khi gate này PASS.

| Package | Pin / nhóm | Kết quả metadata |
|---|---|---|
| `@tiptap/core` | `3.31.3`, dependency | PASS; peer `@tiptap/pm` đúng `3.31.3` |
| `@tiptap/react` | `3.31.3`, dependency | PASS; peers core/pm `3.31.3`, React/react-dom và React types chấp nhận major 19 |
| `@tiptap/pm` | `3.31.3`, dependency | PASS; không trả thêm peer/engine restriction |
| `@tiptap/starter-kit` | `3.31.3`, dependency | PASS; không trả thêm peer/engine restriction |
| `@playwright/test` | `1.63.0`, devDependency | PASS; Node `>=20`, phù hợp Node 22 và local 24 |

Đã cài đúng `--save-exact`, Playwright dùng `--save-dev --save-exact`, với process-local dummy DATABASE_URL, `DOTENV_CONFIG_PATH=NUL` và `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Không dùng `--force`/`--legacy-peer-deps`, không cài browser hoặc package trực tiếp ngoài năm package đã duyệt. Không phê duyệt hàng loạt các dependency install scripts mà npm báo chưa được cho phép; Prisma generate được chạy tường minh và PASS.

`npm.cmd ls @tiptap/core @tiptap/react @tiptap/pm @tiptap/starter-kit @playwright/test react react-dom --depth=0`: **PASS**, đủ pins; React/react-dom giữ `19.2.4`. So lockfile với HEAD: **49 entry mới, 0 entry cũ bị xóa hoặc đổi version**. Next `16.2.6`, Prisma `7.8.0` và stack hiện có được giữ nguyên.

## 3. Implementation và bằng chứng bảo vệ dữ liệu

**Routes/UI.** `/creator/articles` phân trang 20 bài, mới nhất theo `updatedAt DESC, id DESC`; `/new` chỉ render form; `/[id]/edit` đọc trong scope rồi kiểm tra policy/status. Cả ba guard `cms:access` trước article query, dùng một PortalShell. Dashboard giữ metrics/10 recent cards, thêm CTA và eligible edit links; summary select chỉ bổ sung `authorId`, không lấy body.

TipTap là Client Component với `immediatelyRender: false`. Toolbar bao gồm toàn bộ nodes/marks đã duyệt; StarterKit được mở rộng Link tại chỗ, không đăng ký Link/Underline trùng. Pasted link chuẩn hóa target/rel và bỏ class/title trình bày. Editor có labels, trạng thái nút, aria-live, manual save, khóa form/editor và chống double submit bằng ref trong request pending. Sau create giữ khóa tới khi chuyển sang edit route. Dirty state cảnh báo beforeunload và app links; lỗi giữ nội dung. Không lưu draft vào localStorage.

**Authorization/mutations.** Actor đến từ session. Trong transaction Serializable, đọc lại User và yêu cầu ACTIVE, role khớp session và còn quyền CMS. CREATOR chỉ own; ADMIN/SUPER_ADMIN theo article scope hiện có. Cả ba role chỉ sửa DRAFT/CHANGES_REQUESTED. Không đổi `canUpdateArticle` hoặc role matrix.

Lookup dùng `AND: [{ id }, articleCmsScope(actor)]`. Conditional `updateMany` thực tế bao gồm:

```ts
AND: [
  { id: article.id },
  articleCmsScope(actor),
  { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
  { updatedAt: expectedUpdatedAt },
  { authorId: article.authorId, status: article.status, editorSchemaVersion: 1 },
]
```

Write allowlist: title, canonical slug, excerpt, articleType, validated contentJson, server-derived contentText; update thêm updatedAt. Create đặt authorId từ actor, DRAFT và schema version 1. Payload có bất kỳ field ngoài contract đều bị reject; không ghi owner/lifecycle/relations từ client. Không yêu cầu AuthorProfile. JSON/text được ghi cùng transaction.

Token mới là `max(Date.now(), previousMilliseconds + 1)`; count phải bằng 1 và token đọc lại từ DB phải lớn hơn token cũ mới được commit. Trả persisted id/slug/token. Không retry dữ liệu cũ. Migration CMS-001 hiện có lưu DATETIME(3); khả năng cạnh tranh/precision trên MariaDB thật vẫn **STAGING PENDING**.

**Document contract.** Shared schema dùng ở client và server, server không cần DOM. Preflight JSON thuần trước ProseMirror, reject accessors/cycles/prototype keys/unknown node-mark-attribute/nesting. Giới hạn 256 KiB UTF-8, 5.000 nodes, depth 32, derived text 200.000 code points; H2/H3; URL http(s) tuyệt đối, không credentials/control characters. Canonical JSON tạo text có newline giữa blocks/lists/hardBreak, giữ tiếng Việt/code. Empty body chuẩn hóa một paragraph trống. Stored version khác 1 hoặc document invalid trả UNSUPPORTED_DOCUMENT, không overwrite.

**Errors.** Stable codes: VALIDATION_ERROR, SLUG_CONFLICT, FORBIDDEN, NOT_FOUND, NOT_EDITABLE, EDIT_CONFLICT, UNSUPPORTED_DOCUMENT, INTERNAL_ERROR. Missing/foreign trả cùng NOT_FOUND. Chỉ constraint slug của Article được map SLUG_CONFLICT; không trả raw Prisma/stack/query/body/credentials. Framework guard/redirect ở ngoài catch tổng quát. Lỗi revalidation sau commit trả saved + safe warning; không mô tả thành rollback.

## 4. Local validation — kết quả thực tế

Mỗi shell validation dùng `DATABASE_URL=mysql://build:build@127.0.0.1:3306/build` và `DOTENV_CONFIG_PATH=NUL`. Unit/action/route/harness tests dùng boundary mocks, không kết nối DB. Các kết quả cuối đều exit 0:

| Lệnh / kiểm tra | Kết quả |
|---|---|
| `npx.cmd prisma validate` | **PASS** |
| `npx.cmd prisma generate` | **PASS**, client `7.8.0` |
| `node --test tests/*.test.mjs` | **PASS — 396/396**, 0 failed/skipped/cancelled |
| `npm.cmd run test:unit` | **PASS — 396/396**, xác nhận chạy cùng full suite được cấu hình trong CI |
| `npm.cmd run lint` | **PASS** |
| `npx.cmd tsc --noEmit --incremental false` | **PASS** |
| `npm.cmd run build` | **PASS**, production Next 16.2.6; cả ba route mới xuất hiện trong build output |
| `npm.cmd run test:e2e:list` | **PASS — 20 cases**, chỉ discovery, không browser/global setup/DB |
| `git diff --check` | **PASS** |
| Protected-path diff / staged diff | **PASS**, không có thay đổi ở các path bị cấm hoặc file staged |

Production build chạy trong snapshot ignored `.next/cms005-local-validation`, copy allowlist source/config và link node_modules đã cài, không copy/read `.env`. Dummy auth/integration values được đặt ở process; preload chặn đọc file tên `.env*` và socket tới dummy DB port 3306. Hậu kiểm SHA-256: **153 source/config files khớp workspace**; chỉ `next-env.d.ts` trong snapshot được Next tự sinh lại từ dev-types sang production-types. Root TypeScript check riêng bao gồm cả Playwright/config/tests mới. Snapshot build kiểm chứng app production, không phải browser hydration hay DB behavior.

Test breakdown liên quan:

| File | Passed |
|---|---:|
| `tests/cms-article-draft-validation.test.mjs` | 14 |
| `tests/cms-article-draft-actions.test.mjs` | 21 |
| `tests/cms-article-draft-routes.test.mjs` | 12 |
| `tests/cms-e2e-harness.test.mjs` | 17 |
| `tests/cms-dashboard.test.mjs` | 27 |
| Các tests hiện có còn lại, gồm CMS-002/003 và CRM | 305 |
| **Tổng** | **396** |

Đã sửa các vấn đề tìm thấy trong lượt implementation: form mở khóa sớm sau create, pasted-link presentation attrs, test selector nhóm định dạng, fixture mutation thiếu kiểm tra identity hiện tại, setup chưa xác nhận nhưng cleanup tự động, và Playwright tự sinh error-context có thể chứa giá trị input.

Lint lần đầu phát hiện hai native `require` trong script CommonJS vận hành CMS-004 có sẵn. Chỉ thêm override `@typescript-eslint/no-require-imports: off` cho `docs/cms/operations/*.cjs`, giữ các rule còn lại; không sửa hoặc chạy cleanup CMS-004. Các warning còn lại không gây lỗi: native TypeScript module-type warning có sẵn, Git LF/CRLF/global-ignore permission warning, và Next nhiều lockfile do snapshot nằm trong workspace. Không đổi module type/runtime để che warning.

## 5. Playwright/runbook và các gate chưa chạy

[Runbook](../../../tests/README.cms-e2e.md) và 20 Chromium cases đã được typecheck/discover. Config một worker, không retry, không tự khởi động/reuse webServer. Suite thực hiện login thật, UI/Server Actions/DB thật khi được chạy staging; bổ sung actual HTML clipboard paste và offline browser context, không dùng fake server responses.

Harness chỉ chạy khi gọi staging wrapper tường minh sau review/CI: kiểm tra exact base/auth URL `http://127.0.0.1:3001`, DB host `127.0.0.1:3307`, database `edpmjmha_lkcstage`, user `edpmjmha_lkcstg`; kiểm tra SELECT DATABASE()/CURRENT_USER() trước write. Từ chối port bận, không kill server khác. Kiểm tra checkout/provenance, build source snapshot không env với dummy URL, rồi mới khởi động runtime staging của chính checkout.

Mỗi run có manifest/runId/namespace riêng, sáu account ngẫu nhiên cho CREATOR A/B, ADMIN, SUPER_ADMIN, ANALYST, CLIENT và exact fixture articles. Credentials ở memory/process env, chỉ hash được ghi khi staging thực thi. Không tạo AuthorProfile. Cleanup kiểm tra lại identity/ownership/relations, xử lý exact fixture AUTH_LOGIN logs/articles/users trong transaction, yêu cầu remaining article/profile/user/log counts đều 0 cả trong transaction và sau commit. Fixture setup chưa xác nhận thì không tự delete; có recovery manifest/runbook để operator review. Không prefix-wide delete, không reuse CMS-004 fixtures.

Trace/video/screenshots/auth state không lưu; reporter chỉ xuất static case/result. Runner đặt `PLAYWRIGHT_NO_COPY_PROMPT=1`, global setup yêu cầu giá trị này, config `preserveOutput: 'never'` để chặn/loại output tự động, gồm Playwright 1.63 error-context ARIA snapshot. Guard có unit regression; không coi unit test là bằng chứng artifact behavior trên browser đã chạy.

| Gate | Trạng thái |
|---|---|
| Local source/tests/config/discovery | **PASS** |
| Claude independent review | **NOT RUN**, đây là handoff |
| PR CI trên Node 22 | **NOT RUN**, workflow đã có unit step sau Prisma generate |
| Chromium E2E, hydration, clipboard, offline, responsive/keyboard | **STAGING PENDING — NOT RUN** |
| MariaDB concurrency, revocation/status/owner races, DATETIME(3) | **STAGING PENDING — NOT RUN** |
| Actual fixture setup/teardown/remaining=0 | **STAGING PENDING — NOT RUN** |
| Merge/deploy/production smoke | **NOT RUN** |
| Blocker local đã biết sau validation | **Không có BLOCKED** |

## 6. Mapping CMS005-AC-01 → CMS005-AC-30

PASS dưới đây chỉ khẳng định cấp bằng chứng ghi cùng dòng. `IMPLEMENTED-PENDING-STAGING` nghĩa là code/test đã chuẩn bị nhưng browser/DB thực chưa được chạy; không tương đương hoàn tất AC runtime.

| AC | Trạng thái | Bằng chứng / phần còn chờ |
|---|---|---|
| CMS005-AC-01 | PASS | Route tests, dashboard links, production route output; browser navigation pending |
| CMS005-AC-02 | PASS | Actual route/action tests xác nhận guard trước query, actor từ session |
| CMS005-AC-03 | PASS | Real policies + scoped mocked actions/queries: creator own, roles ngoài CMS deny |
| CMS005-AC-04 | PASS | Creator/admin/super owner/status matrix tests, gồm admin sửa super-authored draft |
| CMS005-AC-05 | PASS | Fresh User ACTIVE/exact-role check, forged payload rejected; live revocation pending |
| CMS005-AC-06 | PASS | Assertions trên actual Prisma where AND cho read/count/list/conditional write |
| CMS005-AC-07 | PASS | New route không query/write; create own DRAFT; GET/typing browser case pending |
| CMS005-AC-08 | PASS | Exact write allowlist tests, owner/status/lifecycle metadata được giữ |
| CMS005-AC-09 | IMPLEMENTED-PENDING-STAGING | Manual states, synchronous lock/double-submit ref, create-navigation lock; browser pending |
| CMS005-AC-10 | IMPLEMENTED-PENDING-STAGING | Client boundary/immediatelyRender false, build PASS; hydration chưa chạy |
| CMS005-AC-11 | PASS | Shared schema canonical JSON/text tests và actual action data/transaction assertions |
| CMS005-AC-12 | PASS | Pure/action tests types, unknown attrs/nesting, URL, bytes/nodes/depth/code points |
| CMS005-AC-13 | IMPLEMENTED-PENDING-STAGING | Pure round-trip Vietnamese/code/list/marks PASS; persisted browser round-trip prepared |
| CMS005-AC-14 | PASS | Blank canonical body và không AuthorProfile lookup trong tests; real save pending |
| CMS005-AC-15 | PASS | Constraint-specific safe slug error/rollback tests; UI collision scenario pending |
| CMS005-AC-16 | IMPLEMENTED-PENDING-STAGING | Conditional transaction/stale/readback/fallback tests PASS; actual SQL isolation/precision pending |
| CMS005-AC-17 | PASS | Missing/foreign identical NOT_FOUND, không metadata/body leak trong actual query/action tests |
| CMS005-AC-18 | PASS | Unsupported stored version/document read/write tests; không silent overwrite |
| CMS005-AC-19 | IMPLEMENTED-PENDING-STAGING | Dirty/error retention, beforeunload/app links; offline/dirty-dialog browser case prepared |
| CMS005-AC-20 | PASS | Summary select/order/20-row pagination/scope và dashboard eligibility tests |
| CMS005-AC-21 | IMPLEMENTED-PENDING-STAGING | Labels/aria/buttons/CSS implemented; 390/768/1280, code-scroll/keyboard cases prepared |
| CMS005-AC-22 | PASS | Full 396/396 suite, gồm CMS-002/003/004 regressions |
| CMS005-AC-23 | NOT RUN — CI | Local script 396/396 PASS; unit step đã thêm sau generate; remote Node 22 job chưa chạy |
| CMS005-AC-24 | PASS | Năm metadata gates, exact pins, npm ls, lockfile integrity; không peer override |
| CMS005-AC-25 | PASS — foundation | Config/source/runbook/typecheck/discovery 20 cases; staging execution pending |
| CMS005-AC-26 | IMPLEMENTED-PENDING-STAGING | Real login/actions/DB suite prepared; không chạy browser hoặc giả kết quả |
| CMS005-AC-27 | IMPLEMENTED-PENDING-STAGING | 17 harness mock tests PASS; actual setup/cleanup/count=0 chưa có evidence |
| CMS005-AC-28 | PASS | Protected-path diff; schema/migrations/roles/auth/public-site/deploy code unchanged |
| CMS005-AC-29 | PASS | Chỉ draft manual save; không autosave/workflow/revision/media/CMS audit implementation |
| CMS005-AC-30 | PASS | Prisma validate/generate, full lint/tsc, production build, diff-check exit 0 |

## 7. Mapping EDIT-01 → EDIT-24

| Scenario | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| EDIT-01 | PASS — local; STAGING PENDING | Route/action guard và redirect tests; anonymous browser case prepared |
| EDIT-02 | PASS — local; STAGING PENDING | Non-CMS mutation deny tests, CLIENT/ANALYST browser route-denial prepared |
| EDIT-03 | PASS | Real validator/action tests reject owner/status/text/lifecycle/relation injection |
| EDIT-04 | PASS — local; STAGING PENDING | Create own DRAFT/schema/text action tests; real create prepared |
| EDIT-05 | PASS — route; STAGING PENDING | GET không write/query; browser GET/typing no-write assertions prepared |
| EDIT-06 | IMPLEMENTED-PENDING-STAGING | Pure round-trip PASS; refresh/format/DB round-trip prepared |
| EDIT-07 | PASS — local; STAGING PENDING | Foreign/missing indistinguishable read/update; browser case prepared |
| EDIT-08 | PASS — local; STAGING PENDING | Own two editable statuses, preserve status; browser saves prepared |
| EDIT-09 | PASS — local; STAGING PENDING | Admin/super cross-owner allowed without reassignment; browser cases prepared |
| EDIT-10 | PASS — local; STAGING PENDING | All excluded statuses denied for all three roles; browser cases prepared |
| EDIT-11 | IMPLEMENTED-PENDING-STAGING | Fresh actor mock tests PASS; staging suspend/demote mid-edit prepared |
| EDIT-12 | IMPLEMENTED-PENDING-STAGING | Conditional count/scope/status tests PASS; live owner/status changes prepared |
| EDIT-13 | IMPLEMENTED-PENDING-STAGING | Stale token/rollback tests PASS; two-tab simultaneous real saves prepared |
| EDIT-14 | IMPLEMENTED-PENDING-STAGING | Same-ms helper/action PASS; staging future stored time +1ms twice checks real precision, not a claim two HTTP requests finish in one physical millisecond |
| EDIT-15 | PASS — local; STAGING PENDING | Normalization/constraint/error/rollback tests; browser uppercase slug collision prepared |
| EDIT-16 | PASS — local; STAGING PENDING | Empty body/missing profile tests; real blank save prepared |
| EDIT-17 | PASS | Invalid structure/attrs/version tests reject and preserve old state |
| EDIT-18 | PASS — schema; STAGING PENDING | Unsafe URI rejection and actual shared parseDOM attribute test PASS; Chromium HTML clipboard/script safety prepared |
| EDIT-19 | PASS | Bytes/depth/node/text/metadata boundary tests against real validators |
| EDIT-20 | PASS — action; STAGING PENDING | Failure/rollback/safe logging tests; real offline UI preservation/retry prepared |
| EDIT-21 | PASS — query/route; STAGING PENDING | Scope/count/minimal selects/navigation tests; browser list/dashboard refresh prepared |
| EDIT-22 | IMPLEMENTED-PENDING-STAGING | Responsive/keyboard and long-code internal-scroll browser assertions prepared |
| EDIT-23 | PASS — mocked; STAGING PENDING | Wrong URL/identity/port blocks before fixture mutations; no live tunnel/port tests claimed |
| EDIT-24 | PASS — mocked; STAGING PENDING | Exact IDs/relations, cleanup after PASS/FAIL, rollback and postcommit failures; real remaining=0 NOT RUN |

## 8. Files changed và git status

File groups: three routes; shared schema/contract/actions/queries; editor/form/scoped CSS; dashboard navigation/select; four new unit test files and dashboard regression update; CI/dependencies/lint/ignore; four staging scripts, four E2E files, config/runbook; roadmap checkpoint và report này.

`git status --short --branch --untracked-files=all` tại handoff (không có staged files):

```text
## feature/cms-005-draft-editor-tiptap...origin/feature/cms-005-draft-editor-tiptap
 M .github/workflows/ci.yml
 M .gitignore
 M docs/cms/ROADMAP.md
 M eslint.config.mjs
 M package-lock.json
 M package.json
 M src/app/creator/page.tsx
 M src/features/cms/dashboard.ts
 M tests/cms-dashboard.test.mjs
?? docs/cms/reports/CMS-005-implementation.md
?? playwright.config.ts
?? scripts/cms-e2e/cleanup.mjs
?? scripts/cms-e2e/fixtures.mjs
?? scripts/cms-e2e/guard.mjs
?? scripts/cms-e2e/run.mjs
?? src/app/creator/articles/[id]/edit/page.tsx
?? src/app/creator/articles/new/page.tsx
?? src/app/creator/articles/page.tsx
?? src/features/cms/article-draft-actions.ts
?? src/features/cms/article-draft-query.ts
?? src/features/cms/article-draft.ts
?? src/features/cms/components/ArticleDraftForm.tsx
?? src/features/cms/components/ArticleEditor.module.css
?? src/features/cms/components/ArticleEditor.tsx
?? src/features/cms/editor-schema.ts
?? tests/README.cms-e2e.md
?? tests/cms-article-draft-actions.test.mjs
?? tests/cms-article-draft-routes.test.mjs
?? tests/cms-article-draft-validation.test.mjs
?? tests/cms-e2e-harness.test.mjs
?? tests/e2e/cms-draft.spec.ts
?? tests/e2e/cms-editor-safety.spec.ts
?? tests/e2e/global-setup.ts
?? tests/e2e/safe-reporter.mjs
```

## 9. Handoff / confirmations

Claude review nên tập trung transaction/conditional predicates và Prisma error mapping, strict shared document/paste contract, client pending/navigation state, fixture recovery/cleanup guards, và credential-artifact suppression phụ thuộc pin Playwright 1.63.0. Sau review/CI PASS mới chạy staging runbook và ghi evidence thật; chưa có kết luận về SQL isolation, browser UX hoặc cleanup trên database thật.

Không sửa Prisma schema/migration, role policy, Auth/CRM behavior, public pages hoặc deploy workflow. Không đọc/in/sửa `.env`/secrets; không SSH, database query/connection, migrate/db push/reset/seed, browser install hoặc cleanup CMS-004. SQL/fixture code chỉ được viết và kiểm thử bằng mocks trong lượt này. Không git add, commit, push, merge hoặc deploy. Dừng ở báo cáo này để chuyển independent review.
