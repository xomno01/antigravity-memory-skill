# 🧠 Antigravity Memory Skill (`v1.3.0`)

[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-zero-blue.svg)](#)
[![Smoke Tests](https://img.shields.io/badge/tests-31%2F31%20passing-success.svg)](#kiểm-thử-smoke-tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#)

> **Hệ thống trí nhớ dài hạn (Long-Term Memory), Nhật ký suy luận (Thinking Journal) và Bài học kinh nghiệm (Procedural Lessons) chuẩn Local-First dành cho Google Antigravity IDE.**

**Antigravity Memory Skill** giúp AI Agent trong Google Antigravity ghi nhớ xuyên suốt qua nhiều phiên làm việc — từ kiến trúc dự án, quy ước code, sở thích cá nhân, các quyết định kỹ thuật cho tới những lỗi đã gặp và cách phòng tránh. Toàn bộ dữ liệu được lưu dưới dạng **Markdown thuần túy** ngay trên máy của bạn, **0 thư viện phụ thuộc (Zero Dependencies)**, không gọi mạng, không telemetry và hoàn toàn thân thiện với Git.

---

## ✨ Điểm nổi bật (Key Features)

| Tính năng | Mô tả chi tiết |
| :--- | :--- |
| **🧭 Memory Router (`<= 40 dòng`)** | Tự động nạp bản tóm tắt siêu gọn ở đầu mỗi phiên (`SessionStart`), giữ trọn ngữ cảnh quan trọng mà không làm tràn Context Window. |
| **🔍 Tìm kiếm BM25-lite + Recency** | Xếp hạng thông minh kết hợp trọng số tầng nhớ (Tier Weight), độ quan trọng (`importance 1..5`), độ mới (Recency Half-life 60 ngày) và khớp cụm từ (Phrase Bonus), hỗ trợ tiếng Việt & tiếng Anh. |
| **🛡️ Chặn Secret & Lọc Rác AI (v1.3.0)** | Tự động chặn lưu API keys, Tokens, Private Keys, Passwords, số thẻ VÀ tự động lọc/chặn các câu từ chối sáo rỗng của AI (*"Em không thể hỗ trợ thực hiện việc này giúp anh được ạ"*, *"I cannot fulfill this request"*...). |
| **🛠️ Procedural Lessons (`lesson-check`)** | Lưu lại bài học sau mỗi lần bug/test fail kèm chữ ký lỗi (`error_signature`), triệu chứng (`what`), nguyên nhân gốc (`why`) và cách phòng tránh (`prevention_check`). |
| **📓 Thinking Journal (`05_thinking-journal`)** | Nhật ký suy nghĩ có cấu trúc cho các tác vụ phức tạp (>3 bước): ghi rõ mục tiêu, tiêu chí nghiệm thu, các phương án đã cân nhắc và kết quả thực tế. |
| **🧹 Chống rác phiên làm việc (Anti-Spam)** | Hook `Stop` thông minh: bỏ qua phiên rỗng, giới hạn tối đa 1 skeleton/ngày, tự động cập nhật lại Router ngay sau mỗi thao tác ghi/xóa. |

---

## 🏗️ Kiến trúc kho nhớ (Storage Layout)

Kho nhớ được tổ chức thành 5 tầng thư mục rõ ràng cùng chỉ mục tìm kiếm tự động:

```text
<memory-store>/
├── 00_MEMORY_ROUTER.md          # Bản đồ tóm tắt tự sinh (<= 40 dòng) — nạp mỗi đầu phiên
├── 01_user-profile/             # Thông tin & sở thích cá nhân của người dùng (user, preference)
├── 02_episodic/                 # Quyết định kỹ thuật & tóm tắt phiên làm việc (decision, episodic)
├── 03_semantic/                 # Kiến thức bền vững, kiến trúc & sự thật dự án (project, fact, other)
├── 04_procedural-lessons/       # Bài học xương máu từ lỗi/bug kèm chữ ký lỗi (lesson)
├── 05_thinking-journal/         # Nhật ký suy luận cho tác vụ nhiều bước (<YYYY-MM-DD>-<slug>.md)
└── index.json                   # Chỉ mục tìm kiếm BM25-lite (tự động đồng bộ khi file thay đổi)
```

**Thứ tự ưu tiên xác định vị trí kho nhớ:**
1. Cờ `--dir <path>` truyền trực tiếp qua CLI
2. Biến môi trường `AGMEM_DIR`
3. `<workspace>/.agents/memory` (nếu trong thư mục làm việc có `.agents/`)
4. Mặc định toàn cục: `~/.antigravity-memory` (hoặc `%USERPROFILE%\.antigravity-memory` trên Windows)

---

## 🚀 Cài đặt (Installation)

**Yêu cầu duy nhất:** `Node.js >= 18`

### Cách 1: Dùng `install.sh` (Git Bash / macOS / Linux)

```bash
# Cài đặt toàn cục (Global - áp dụng cho mọi dự án)
bash install.sh --global

# Hoặc cài đặt riêng cho dự án hiện tại (Project-scoped)
bash install.sh --project
```

### Cách 2: Cài đặt nhanh bằng PowerShell trên Windows

```powershell
$SKILL_DST = "$env:USERPROFILE\.gemini\config\skills\antigravity-memory"
$RULE_DST  = "$env:USERPROFILE\.gemini\config\rules"
New-Item -ItemType Directory -Path $SKILL_DST, $RULE_DST -Force | Out-Null

Copy-Item -Path "SKILL.md","scripts","rules","references","memory-templates","hooks" `
          -Destination $SKILL_DST -Recurse -Force
Copy-Item -Path "rules\memory-always-on.md" -Destination "$RULE_DST\memory-always-on.md" -Force
```

> **Lưu ý về `hooks.json`:** Trình cài đặt sử dụng chuẩn **Antigravity Hooks v2** (có namespace `"antigravity-memory"` và `"type": "command"`), tự động sao lưu `hooks.json.bak` và gộp (merge) an toàn mà không làm mất các hook sẵn có của bạn.

---

## 💻 Bảng lệnh CLI (`scripts/memory.js`)

```bash
node scripts/memory.js <command> [args] [--dir <path>]
```

### 1. Nạp ngữ cảnh & Tìm kiếm
```bash
# In Memory Router + Top entries theo độ ưu tiên (mặc định 30 mục)
node scripts/memory.js context [--max-items 30]

# Tìm kiếm thông minh với BM25-lite + lọc theo danh mục và khoảng thời gian
node scripts/memory.js search "firebase auth" [--limit 8] [--category project] [--after 2026-01-01] [--before 2026-12-31]
```

### 2. Lưu trữ & Quản lý Ký ức (CRUD)
```bash
# Lưu một sự thật / quyết định / sở thích mới
node scripts/memory.js save \
  --content "Luôn dùng Antigravity Hooks v2 có namespace và type:command" \
  --category decision \
  --tags "hooks,agy" \
  --confidence verified \
  --importance 5

# Xem chi tiết, liệt kê, cập nhật hoặc xóa một mục nhớ
node scripts/memory.js get m_3011409ef9
node scripts/memory.js list [--category decision] [--limit 50]
node scripts/memory.js update m_3011409ef9 --importance 5 --tags "hooks,core"
node scripts/memory.js delete m_3011409ef9
```

### 3. Bài học từ lỗi (Procedural Lessons)
```bash
# Ghi lại bài học sau khi fix bug hoặc bị người dùng nhắc sửa
node scripts/memory.js lesson-add \
  --title "Hooks v2 thiếu trường type gây lỗi khởi tạo" \
  --what "Hooks không chạy khi mở phiên mới" \
  --why "Thiếu trường type: command trong mỗi phần tử mảng sự kiện" \
  --where "hooks/hooks.json" \
  --lesson "Luôn khai báo type: command và bọc trong namespace riêng" \
  --trigger "Khi cấu hình hoặc sửa file hooks.json" \
  --prevention "Chạy smoke test kiểm tra schema hooks.json trước khi cài" \
  --signature "hooks.json,type:command,sessionstart" \
  --importance 5

# Kiểm tra nhanh lỗi đang gặp có khớp với bài học nào trong quá khứ không
node scripts/memory.js lesson-check "error parsing hooks.json on sessionstart"
```

### 4. Nhật ký suy nghĩ (Thinking Journal)
```bash
# Mở journal trước khi làm tác vụ dài (>3 bước)
node scripts/memory.js journal-start \
  --slug "refactor-memory-engine" \
  --goal "Nâng cấp bộ lọc chống rác và đồng bộ router tức thì" \
  --criteria "100% smoke tests pass, không lọt câu từ chối AI"

# Ghi chú tiến độ trong lúc làm
node scripts/memory.js journal-note --slug "refactor-memory-engine" --note "Đã thêm REFUSAL_PATTERNS vào lessons.js"

# Đóng journal khi hoàn tất
node scripts/memory.js journal-close --slug "refactor-memory-engine" --outcome "Hoàn thành v1.3.0 với 31/31 tests pass"

# Liệt kê danh sách journal (dùng --open để chỉ xem các journal chưa đóng)
node scripts/memory.js journal-list [--open]
```

### 5. Dọn dẹp & Bảo trì Kho nhớ
```bash
# Xóa các file skeleton tóm tắt phiên chưa được điền (thêm --dry-run để xem trước)
node scripts/memory.js prune-skeletons [--dry-run]

# Xóa hoặc làm sạch các entry dính câu từ chối sáo rỗng của AI (v1.3.0+)
node scripts/memory.js prune-noise [--dry-run]

# Xây dựng lại index.json & 00_MEMORY_ROUTER.md (hoặc liệt kê các mục cũ >180 ngày với --stale)
node scripts/memory.js index [--stale]
```

---

## 🛡️ Cơ chế Bảo vệ Kép: Secret Guard & AI Refusal Filter

### 1. Chặn tuyệt đối thông tin nhạy cảm (Secret Guard)
Mọi lệnh ghi (`save`, `update`, `lesson-add`, `journal-note`, `journal-close`) đều đi qua bộ lọc `SECRET_PATTERNS`:
- Dãy số dài `14–19 chữ số` (số thẻ ngân hàng, CCCD, tài khoản).
- Google API Keys (`AIza...` từ 30 ký tự trở lên).
- API / OAuth Tokens (`sk-`, `pk-`, `ghp_`, `gho_`, `xoxa-`, `xoxb-`, `xoxp-`...).
- Khóa riêng chuẩn PEM (`-----BEGIN ... PRIVATE KEY-----`).
- Cú pháp gán mật khẩu (`password=...`, `passwd: ...`).

> Khi phát hiện secret, CLI **từ chối lưu ngay lập tức** và chỉ báo tên nhóm mẫu vi phạm, tuyệt đối không in lại giá trị nhạy cảm ra màn hình hay log.

### 2. Chặn & Lọc câu từ chối sáo rỗng của AI (Refusal / Boilerplate Filter — Mới ở `v1.3.0`)
Ngăn chặn hoàn toàn tình trạng AI vô tình lưu các câu từ chối/xin lỗi vô nghĩa vào bộ nhớ dài hạn:
- Tự động nhận diện các mẫu câu từ chối bằng cả **tiếng Việt (có dấu & không dấu)** lẫn **tiếng Anh**, ví dụ:
  - *"Em không thể hỗ trợ thực hiện việc này giúp anh được ạ"*
  - *"Xin lỗi, em không thể đáp ứng yêu cầu này"*
  - *"Là một mô hình ngôn ngữ AI, tôi không thể..."*
  - *"I cannot fulfill this request" / "I apologize, but I cannot assist with that task"*
- **Xử lý thông minh 2 tầng:**
  1. Nếu nội dung nhiều dòng có chứa thông tin thật kèm 1 dòng từ chối sáo rỗng: **tự động cắt bỏ dòng từ chối** và giữ lại phần kiến thức thật.
  2. Nếu toàn bộ nội dung chỉ là câu từ chối của AI: **chặn lưu hoàn toàn** (`exit 1`) để giữ kho nhớ luôn sạch sẽ.

---

## 🧪 Kiểm thử (Smoke Tests)

Bộ kiểm thử tự động gồm **31 test cases** chạy hoàn toàn trong thư mục tạm (`os.tmpdir()`), cam kết không chạm vào kho nhớ thật của bạn:

```bash
node test/smoke.js
```

Kết quả mong đợi:
```text
PASS - 1. save -> search finds the saved entry (top results contain its content)
...
PASS - 28. --version reports 1.3.0
PASS - 29. save blocks AI refusal/boilerplate sentences (VI + EN)
PASS - 30. save strips AI refusal line while keeping real factual lines
PASS - 31. prune-noise deletes refusal entry and cleans mixed entry

31 passed, 0 failed, 31 total.
```

---

## 📋 Lịch sử phiên bản (Changelog)

- **`v1.3.0`**:
  - Thêm bộ lọc `REFUSAL_PATTERNS` chặn và bóc tách các câu từ chối sáo rỗng của AI (Tiếng Việt có dấu/không dấu & Tiếng Anh).
  - Thêm lệnh `prune-noise [--dry-run]` để quét và dọn sạch các câu từ chối AI trong kho nhớ.
  - Mở rộng bộ kiểm thử lên **31/31 smoke tests**.
- **`v1.2.0`**:
  - Khắc phục triệt để lỗi *Skeleton Storm* ở `session-stop.js` (bỏ qua kho nhớ rỗng, tối đa 1 skeleton/ngày).
  - Tự động đồng bộ `00_MEMORY_ROUTER.md` ngay sau mỗi lệnh `save`, `update`, `delete`, `lesson-add`.
  - Thêm các lệnh `journal-list [--open]`, `prune-skeletons [--dry-run]`, bộ lọc ngày `search --after/--before`.
- **`v1.1.0`**:
  - Chuẩn hóa `hooks/hooks.json` sang định dạng Antigravity v2; hỗ trợ đầy đủ Windows (`USERPROFILE`) & Git Bash.
