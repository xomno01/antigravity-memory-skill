'use strict';

// Library module for procedural lessons + secret blocking.
// Used by scripts/memory.js (the CLI). Zero dependencies, Node.js stdlib only.
//
// Secret patterns below are reimplemented from the plain-language descriptions
// in the skill spec (§7). They are original code written for this spec, not
// copied from any other project.

const SECRET_PATTERNS = [
  {
    name: 'long-digit-sequence',
    // 14-19 digits, allowing single spaces or dashes between digits
    // (card / national ID / account numbers).
    regex: /\d(?:[ -]?\d){13,18}/,
  },
  {
    name: 'google-api-key',
    // Google API keys: "AIza" followed by 30+ base64url characters.
    regex: /AIza[0-9A-Za-z_-]{30,}/,
  },
  {
    name: 'api-token',
    // Token prefixes followed by 16+ token characters.
    regex: /(?:sk-|pk-|ghp_|gho_|xox[abp]-)[A-Za-z0-9_-]{16,}/,
  },
  {
    name: 'pem-private-key',
    // PEM private key header line.
    regex: /-----BEGIN [^-]*PRIVATE KEY-----/,
  },
  {
    name: 'password-assignment',
    // password/passwd followed by ":" or "=" and a value.
    regex: /(?:password|passwd)\s*[:=]\s*\S+/i,
  },
];

// Check text against every secret pattern.
// Returns { blocked: boolean, pattern: string|null }.
// The matched secret itself is NEVER returned or printed.
function checkSecrets(text) {
  const s = String(text == null ? '' : text);
  for (const p of SECRET_PATTERNS) {
    if (p.regex.test(s)) {
      return { blocked: true, pattern: p.name };
    }
  }
  return { blocked: false, pattern: null };
}

// Error message for a blocked write. Names only the pattern class,
// never the matched content.
function secretErrorMessage(pattern) {
  return 'refused to store: matched secret pattern class "' + pattern + '"';
}

// Canned AI refusal / apology boilerplate patterns (Vietnamese + English).
// Never store generic assistant refusals as durable memory or lessons.
const REFUSAL_PATTERNS = [
  {
    name: 'vi-cannot-assist',
    regex: /\b(?:em|tôi|mình|chúng tôi)\s+(?:rất tiếc\s+(?:nhưng\s+|vì\s+)?|xin lỗi\s*(?:anh|chị|bạn)?\s*[,nhưng]*\s*)?(?:không thể|chưa thể|không được phép)\s+(?:hỗ trợ|thực hiện|đáp ứng|giúp|làm|xử lý|tiếp tục)\s+(?:thực hiện\s+)?(?:việc này|yêu cầu này|nội dung này|tác vụ này|điều này|giúp\s+(?:anh|chị|bạn))?/iu,
  },
  {
    name: 'vi-cannot-assist-ascii',
    regex: /\b(?:em|toi|minh)\s+(?:rat tiec\s+|xin loi\s+)?(?:khong the|chua the|khong duoc phep)\s+(?:ho tro|thuc hien|dap ung|giup)\s+(?:thuc hien\s+)?(?:viec nay|yeu cau nay|noi dung nay|tac vu nay|giup\s+(?:anh|chi|ban))/i,
  },
  {
    name: 'vi-as-an-ai',
    regex: /\blà một (?:mô hình ngôn ngữ|trợ lý ảo|trợ lý ai|ai)\b.*?\b(?:không thể|không được phép)\b/iu,
  },
  {
    name: 'en-cannot-fulfill',
    regex: /\b(?:i\s+cannot|i\s+can't|i'm\s+unable\s+to|i\s+am\s+unable\s+to|i\s+am\s+not\s+able\s+to)\s+(?:fulfill|assist\s+with|comply\s+with|complete|perform|help\s+(?:you\s+)?with|support)\s+(?:this|that|your)\s+(?:request|task|action)\b/i,
  },
  {
    name: 'en-sorry-cannot-help',
    regex: /\b(?:i'm\s+sorry|i\s+apologize|sorry)\s*,\s*(?:but\s+)?i\s+(?:cannot|can't|am\s+unable\s+to)\s+(?:help|assist|fulfill|provide|comply)\b/i,
  },
  {
    name: 'en-as-an-ai',
    regex: /\bas\s+an?\s+(?:ai|artificial\s+intelligence|language\s+model|helpful\s+assistant)\b[^.\n]*\b(?:cannot|can't|unable\s+to)\b/i,
  },
];

// Check text against AI refusal / boilerplate patterns.
// Returns { blocked: boolean, pattern: string|null }.
function checkRefusals(text) {
  const s = String(text == null ? '' : text).trim();
  for (const p of REFUSAL_PATTERNS) {
    if (p.regex.test(s)) {
      return { blocked: true, pattern: p.name };
    }
  }
  return { blocked: false, pattern: null };
}

// Strip individual lines that consist solely of an AI refusal sentence while
// preserving surrounding factual lines (if any).
function stripRefusalLines(text) {
  const raw = String(text == null ? '' : text);
  const lines = raw.split('\n');
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !checkRefusals(trimmed).blocked;
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function refusalErrorMessage(pattern) {
  return 'refused to store: matched AI refusal/boilerplate pattern "' + pattern + '"';
}

const LESSON_REQUIRED_FIELDS = [
  'title',
  'what',
  'why',
  'where',
  'lesson',
  'trigger',
  'prevention',
];

// Return the list of required lesson fields that are missing/empty.
function validateLessonFields(fields) {
  const missing = [];
  for (const key of LESSON_REQUIRED_FIELDS) {
    const v = fields[key];
    if (v == null || String(v).trim() === '') {
      missing.push(key);
    }
  }
  return missing;
}

// Build the lesson body in the mandatory spec §6 section layout.
function buildLessonBody(fields) {
  return [
    'Title: ' + fields.title,
    'What: ' + fields.what,
    'Why: ' + fields.why,
    'Where: ' + fields.where,
    'Lesson: ' + fields.lesson,
    'Trigger: ' + fields.trigger,
    'Prevention: ' + fields.prevention,
  ].join('\n');
}

// Normalize a comma-separated error_signature into lowercase substrings.
function normalizeSignature(signature) {
  return String(signature == null ? '' : signature)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

// Case-insensitive substring matching for lesson-check.
// Returns the list of signature substrings found in `text`.
function matchLessonSignatures(entry, text) {
  const sigs = normalizeSignature(entry.error_signature);
  if (sigs.length === 0) {
    return [];
  }
  const lower = String(text == null ? '' : text).toLowerCase();
  return sigs.filter((s) => lower.indexOf(s) !== -1);
}

module.exports = {
  SECRET_PATTERNS,
  checkSecrets,
  secretErrorMessage,
  REFUSAL_PATTERNS,
  checkRefusals,
  stripRefusalLines,
  refusalErrorMessage,
  LESSON_REQUIRED_FIELDS,
  validateLessonFields,
  buildLessonBody,
  normalizeSignature,
  matchLessonSignatures,
};
