# BÁO CÁO BÀN GIAO — Skill bộ nhớ cho Google Antigravity

- Tên skill: `antigravity-memory`, phiên bản `1.0.0`
- Thư mục giao: `~/workspace/antigravity-memory-skill/` (thư mục này CHÍNH LÀ skill)
- Ngôn ngữ: README tiếng Việt cho user; SKILL.md, tài liệu kỹ thuật, schema tiếng
  Anh cho agent/developer
- Runtime: Node.js ≥ 18, zero dependency, lõi không gọi mạng, local-first,
  không telemetry

## 1. Danh sách file

| File | Vai trò |
|---|---|
| `SKILL.md` | Skill chính: frontmatter `name: antigravity-memory` + `description` bắt buộc; quy trình session-start, save, lesson, journal, verification gate; mục Honesty |
| `rules/memory-always-on.md` | Rule `trigger: always_on`, 994 byte (dưới cap 2 KB) |
| `hooks/hooks.json` | Chỉ 2 event: `SessionStart`, `Stop` |
| `hooks/session-start.js` | In router/context briefing ra stdout, luôn exit 0, chịu stdin lạ |
| `hooks/session-stop.js` | Ghi 1 episodic session summary skeleton, luôn exit 0, không ghi đè |
| `scripts/memory.js` | CLI duy nhất agent gọi (context/search/save/get/list/update/delete/lesson-add/lesson-check/journal-*/index/--path/--export/--version) |
| `scripts/lessons.js` | Module lesson + chặn secret |
| `scripts/journal.js` | Module thinking journal |
| `memory-templates/` | Router mẫu (16 dòng) + 5 entry mẫu đúng schema (file `_example*`, không bao giờ bị index) |
| `references/schema.md` | Schema lưu trữ đầy đủ + các quyết định lắp ráp (§10) |
| `docs/technical.md` | Tài liệu kỹ thuật tiếng Anh (kiến trúc, CLI, hooks, troubleshooting, bảo mật) |
| `docs/math-model.md` | Hình thức hóa scoring, ngân sách token, ngưỡng quên, ví dụ tính tay |
| `docs/system-model.md` | Mô hình hệ thống: SNR, mật độ thông tin, tối ưu có ràng buộc, vòng phản hồi, metrics |
| `README.md` | Hướng dẫn tiếng Việt: cài đặt, dùng hàng ngày, gỡ cài đặt, giới hạn nói thật |
| `install.sh` | Cài global/project, chỉ copy allowlist, merge hooks có backup, idempotent |
| `test/smoke.js` | 15 case smoke test, chạy trong temp dir |

## 2. Cách cài

```bash
cd ~/workspace/antigravity-memory-skill
./install.sh --global    # mặc định: ~/.gemini/config/skills/antigravity-memory/
./install.sh --project   # trong workspace: ./.agents/skills/antigravity-memory/
```

Install copy đúng allowlist (`SKILL.md`, `scripts/`, `rules/`, `references/`,
`memory-templates/`, `hooks/`); `README.md`, `docs/`, `test/`, `install.sh` không
bị copy sang nơi cài đặt. Hooks được MERGE (backup `hooks.json.bak`), không ghi
đè. Store mặc định: `$HOME/.antigravity-memory` (global) hoặc
`<workspace>/.agents/memory` (project); thứ tự resolve đầy đủ:
`--dir` > `AGMEM_DIR` > `<cwd>/.agents/memory` (nếu có `.agents/`) >
`$HOME/.antigravity-memory`.

## 3. Từng mục tiêu của user được đáp ứng bằng cơ chế nào

1. **Nhớ tất cả những gì agent đã làm** — Capture 3 đường: hook
   `SessionStart` (nạp router) + `Stop` (ghi episodic skeleton); rule `always_on`
   bắt save sau quyết định quan trọng; CLI `save`/`context`/`search` trên kho
   Markdown 5 tầng (user-profile, episodic, semantic, procedural-lessons,
   thinking-journal) + `index.json`. Mọi entry đều có id, category, tags,
   source, confidence, importance, timestamp.
2. **Học kinh nghiệm sau những lần sai** — Khi test fail, lỗi, hoặc user sửa,
   agent BẮT BUỘC `lesson-add` (What/Why có bằng chứng/Where/Lesson/Trigger/
   Prevention + `error_signature`) trước khi retry/báo xong. `lesson-check`
   kéo lesson lên theo số substring signature khớp; search nhân hệ số tầng
   lesson cao nhất (1.6). Bài học lưu dạng Markdown, sửa 1 file là sửa được
   cả hệ thống.
3. **Đọc được "thinking" khi code** — Skill KHÔNG đọc được chain-of-thought ẩn
   của model (ghi rõ trong SKILL.md, README, technical doc). Vật thay thế là
   **thinking journal bắt buộc**: task > ~3 bước → `journal-start` (Goal,
   Acceptance criteria, Hypotheses, Options considered AND rejected with
   reason, Assumptions, Verification plan) TRƯỚC khi hành động →
   `journal-note` sau mỗi bước lớn → `journal-close` (Outcome + Lesson link).
   Journal là file đọc lại và kiểm tra được.
4. **Tối ưu để kết quả đúng và khớp ý user nhất có thể** — Không có gì đảm
   bảo tuyệt đối (ghi rõ, không tô hồng). Cơ chế tối đa hóa khớp ý gồm:
   trích xuất tiêu chí chấp nhận từ yêu cầu ngay đầu phiên (journal +
   SKILL.md), vòng hỏi làm rõ khi mơ hồ/không thể đảo ngược/tốn kém,
   verification gate trước khi báo xong (chạy check thật của dự án, đối
   chiếu tiêu chí), và ghi lesson mỗi khi lệch ý để lần sau tránh.

## 4. Kết quả kiểm chứng thật (chạy tại bước lắp ráp, không phải claim)

- **Smoke test `node test/smoke.js`: 15/15 PASS, exit 0.** Lịch sử trung thực:
  lần đầu 0/15 vì CLI chưa tồn tại (test worker báo thật, không fake pass);
  sau khi có engine: 13/15 → sửa 2 lỗi (1 lỗi output lesson-check thiếu title
  phía engine, 1 lỗi `.getTime()` phía test) → 14/15 → sửa 1 assertion test
  sai (search chỉ in first line, không echo token cuối body) → 15/15.
- **Router:** stress 60 entry + 10 entry mỗi loại → router đúng 40 dòng (cap
  cứng, `index` fail nếu vượt).
- **Stale logic mới:** entry importance 1 backdate 2025-01-01 bị flag đúng 1;
  sau khi search chạm tới nó (ghi `last_accessed_at`) → 0 ứng viên; entry
  `user_stated` importance 5 cùng tuổi → không bao giờ bị flag.
- **Install (HOME giả, không chạm HOME thật):** global + project đều đủ file,
  hooks merge đúng 2 event, chạy lại không trùng, file hooks.json hỏng thì
  không ghi đè. Hook SessionStart với engine thật in đúng router + entry;
  hook Stop tạo đúng 1 skeleton episodic; cả hai luôn exit 0 kể cả stdin rác.
- **Tĩnh:** `node --check` qua hết scripts/hooks/test; `bash -n` qua install.sh;
  grep không thấy gọi mạng trong `scripts/` và `hooks/`; rule 994 byte;
  hooks.json chỉ có SessionStart/Stop; SKILL.md có frontmatter name +
  description; chặn secret 5 nhóm đều exit 1 và không echo secret.

## 5. Quyết định của coordinator khi lắp ráp (lệch spec có lý do)

1. **Stale đo bằng `last_accessed_at` trong `index.json`** (refresh bởi
   search/context/get, fallback `created_at`), thay vì dùng `updated_at` làm
   proxy — vì entry cũ nhưng hay được đọc không được coi là "không truy cập".
2. **Token truy vấn 2 ký tự chỉ khớp chính xác**, token ≥ 3 ký tự mới được
   khớp prefix — giảm nhiễu (đề xuất của nhà toán học, khớp cảnh báo của nhà
   vật lý). Không áp dụng coverage làm tie-breaker (đề xuất khác, để dành).
3. **Router caps theo tầng: User 8 / Projects 6 / Decisions 6 / Lessons 10 /
   Open threads 4** (tổng 34 + 6 header = 40), khớp tài liệu toán (ưu tiên
   lesson triggers vì mục tiêu "học từ sai lầm").
4. **Normalize dedupe = lowercase + gộp whitespace + trim**, áp dụng giống
   nhau lúc save và lookup.
5. **`index.json` = `{version, generated_at, entries[]}`**, mỗi record có thêm
   `last_accessed_at` (null nếu chưa từng được surface). Rebuild giữ lại giá
   trị cũ theo id.
6. **Journal không bị quét như entry** (thư mục `05_*` loại khỏi entry scan);
   giá trị `category: other` trong journal mẫu chỉ mang tính minh họa.
7. **Filename entry = `<id>.md`** (CLI ép); journal = `<YYYY-MM-DD>-<slug>.md`.
8. **`lesson-add --signature` để tùy chọn** (thiếu thì lesson không khớp
   lesson-check, không báo lỗi); chặn secret mở rộng thêm cho `update
   --content` (chống lách); cap body 2000 ký tự chỉ áp cho save/update,
   lesson/journal được miễn vì nội dung có cấu trúc.
9. **Mặc định chưa có trong spec:** save → fact/user/inferred/3; lesson-add →
   importance 4/source session/confidence verified; list limit 50;
   Open threads = entry episodic.
10. **Team:** gộp thành 7 luồng theo module thay vì 20 agent cùng viết một
    skill nhỏ (tránh giẫm chân và lệch interface), vẫn đủ vai trò dev + toán
    + lý. Spec chung viết trước để mọi worker cùng interface.

## 6. Giới hạn còn tồn tại — nói thật, không tô hồng

- **Không đảm bảo "bất kể yêu cầu gì cũng ra đúng ý user".** Skill chỉ tối đa
  hóa khớp ý bằng tiêu chí chấp nhận + vòng làm rõ + verification gate +
  lesson khi lệch ý. Yêu cầu mơ hồ, mâu thuẫn nội tại, hoặc vượt khả năng
  model vẫn có thể ra sai — và khi đó lesson là cơ chế sửa.
- **Không đọc được chain-of-thought ẩn.** Thinking journal chỉ tốt bằng mức
  agent tự ghi trung thực; journal có thể thiếu, viết hậu biện, hoặc sai.
- **Skill chỉ phát huy khi agent tuân thủ.** Nếu agent bỏ qua rule `always_on`
  hoặc hooks không chạy, kho nhớ sẽ không được ghi/đọc. Đây là giới hạn
  chung của mọi giải pháp MCP/file cho Antigravity (không riêng skill này).
- **Trường `command` trong `hooks.json` CHƯA xác minh nguyên văn từ tài liệu
  chính thức.** Tài liệu xác minh được: tên event, vị trí file, hành vi
  handler. Nếu hooks không chạy sau khi cài đúng, mở Settings →
  Customizations → Hooks của đúng build đang dùng để đối chiếu format entry.
- **Không dùng workflows.** Tài liệu workflows có dấu hiệu thay đổi sau
  19/10/2026 mà chưa xác minh được bản thay thế, nên skill không phụ thuộc
  vào workflows.
- **Version drift:** tài liệu cũ dùng `.agent/` (số ít) và
  `~/.gemini/antigravity/skills/`; installer nhắm đường dẫn hiện tại
  (`.agents/`, `~/.gemini/config/skills/`) và in cảnh báo nếu skill bị bỏ qua
  trong im lặng.
- **Bảo mật:** lõi không gọi mạng, không telemetry, chặn 5 nhóm secret khi
  lưu — nhưng file nhớ khi được đọc vào context sẽ được gửi tới model backend
  để suy luận, nên file local KHÔNG đồng nghĩa với riêng tư tuyệt đối khỏi
  model. Không bao giờ lưu secret vào kho nhớ (kể cả qua journal/note).
- **Mô hình toán/lý là heuristic + ước lượng**, chưa fit trên dữ liệu sử dụng
  thật: tier weights, half-life 60 ngày, ngưỡng stale 180 ngày là lựa chọn
  thiết kế có lập luận, không phải hằng số đã validate thực nghiệm. Tài liệu
  toán đề xuất re-estimate sau khi có log sử dụng thật (chưa làm).
- **Đề xuất toán học chưa áp dụng:** coverage làm tie-breaker trong epsilon;
  re-estimate tier weights/half-life từ log. Ghi lại để làm sau, không lặng
  lẽ đưa vào code.

## 7. Việc phát hiện thêm khi test (không thuộc deliverable, cần parent quyết)

- Trong lúc worker test, một file skeleton `2026-10-26-session-summary-m_*.md`
  đã xuất hiện trong `~/.antigravity-memory/02_episodic/` trên HOME thật
  (tạo 11:36 ngày 2026-10-26). Không worker nào nhận là do mình tạo trong
  quy trình chuẩn (mọi test đều khai báo dùng HOME giả). File này đã được
  **để nguyên, không xóa, không động vào** — parent quyết có xóa hay không.
  Nó cũng là bằng chứng rằng hook session-stop có thể ghi vào HOME thật nếu
  biến môi trường bị sót — khi dùng thật, nên kiểm tra `--path` trước.

## 8. Cách tự kiểm chứng lại

```bash
cd ~/workspace/antigravity-memory-skill
node --check scripts/memory.js && node test/smoke.js   # kỳ vọng: 15 passed, 0 failed
HOME=/tmp/fakehome bash install.sh --global            # kỳ vọng: đủ file, hooks 2 event
```
