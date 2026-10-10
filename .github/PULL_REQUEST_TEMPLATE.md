<!-- Điền evidence thật; giữ NOT_RUN/NOT_VERIFIED/OPEN nếu chưa có. Không secrets/credentials/customer data. Governance: docs/lkc-platform/AI-DELIVERY-OPERATING-MODEL.md. Giữ OPEN/DRAFT; template không cấp quyền merge/deploy. -->

## Task / scope / ownership

- Task ID / outcome:
- Codex owner / lane:
- Claude independent reviewer:
- Risk class A/B/C (C chạm shared paths vẫn áp dụng B):
- Shared releasing/receiving owner và effective slot/handoff, hoặc N/A cho A:
- Exclusions / runtime activation boundary:

## Source provenance và dependencies

- Repository / source branch / worktree checkpoint:
- Exact source base SHA / parent SHA(s):
- Published head SHA:
- PR target branch / target SHA đã đối chiếu:
- Dependency PR(s) + exact commit(s), hoặc NONE:
- Main/base drift và ảnh hưởng, hoặc NONE đã kiểm:

| Change | Exact path | SHA-256 bytes đã review | Git-normalized blob working tree / index / commit |
|---|---|---|---|
| CREATE / MODIFY / DELETE | Điền từng path, không wildcard | NOT_VERIFIED | NOT_VERIFIED |

## AC và negative tests

| AC | Expected outcome / negative boundary | Test mapping | Actual result / evidence |
|---|---|---|---|
| Điền ID | Điền outcome | Mapping chưa là test đã chạy | PLANNED / NOT_RUN |

## Author validation

- Source revision / runtime Node/npm / tool versions:
- Commands / environment isolation / output location:
- Focused tests / regression counts PASS, FAIL, SKIP, CANCELLED / skip reasons:
- Lint / TypeScript / Prisma validate/generate / build, hoặc NOT_RUN cùng lý do:
- Allowlist / diff-check kể cả untracked / encoding/conflict / preservation / index:

## Independent reviewer

- Verdict: **NOT_REVIEWED** (thay bằng PASS/FAIL khi có bằng chứng).
- Reviewer / timestamp / exact revision + fingerprints:
- Phạm vi reviewer tự kiểm và tests tự chạy:
- Author/PO-relayed evidence được dùng, nguồn và giới hạn:
- Finding IDs / severity / OPEN hoặc CLOSED / regression revision:
- Drift sau review và cách đối chiếu working tree -> index -> commit:

## Source CI evidence

- Status: **NOT_STARTED**; lý do nếu NOT_RUN:
- Workflow / mode / run URL + ID / job / attempt / event:
- Source head SHA / actual checkout SHA:
- PR synthetic merge SHA + base/head parents, hoặc N/A cho branch dispatch:
- Node/npm thực tế từ log:

| Gate | PASS / FAIL / SKIP / CANCELLED / NOT_RUN | Log evidence / counts / skip reason |
|---|---|---|
| Unit/action và focused tests thực chạy | NOT_RUN | |
| Prisma validate / generate | NOT_RUN | |
| Lint | NOT_RUN | |
| Full TypeScript | NOT_RUN | |
| Production build | NOT_RUN | |
| Candidate job | NOT_VERIFIED | Kiểm skip đúng PR/validate mode; không dùng candidate CI thay source CI |

## DB / staging / consumer / runtime gates

- Target MariaDB version/metadata: **NOT_VERIFIED**, hoặc N/A có lý do:
- DDL apply / compatibility / mixed-version / FK-retention / concurrency / recovery: **NOT_RUN**, hoặc evidence/N/A theo scope:
- Staging/browser/fixture lease và cleanup: **NOT_RUN**, hoặc evidence/N/A:
- Consumer integration / contract ACK / runtime activation: **NOT_RUN**, hoặc evidence/N/A:
- Manual authenticated production UAT: **DEFERRED**.

## OPEN risks và handoff

- Findings/policies/dependencies còn OPEN và operation thực sự bị ảnh hưởng:
- Phần độc lập tiếp tục / receiving owner / next exact dependency:
- Remote head/base/files/blobs đã xác minh:
- Không dùng local PASS, reviewer PASS hoặc CI nhánh khác làm source CI/DB/runtime PASS.

## Merge / release authorization

- Commit/push/Draft PR/CI authorization trong task:
- Production merge/release/DB execution authorization: **NOT_GRANTED** trừ khi ghi quyết định explicit còn hiệu lực, actor/target/scope/time/evidence.
- Branch protection/rulesets: **NOT_VERIFIED** hoặc evidence thực; không bypass/admin fallback.
- Main push kích deploy.yml kể cả docs. Giữ PR OPEN/DRAFT; G0 không merge/deploy/apply migration.
