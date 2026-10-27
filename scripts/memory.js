'use strict';

// Antigravity Memory Skill — storage + retrieval engine (spec §4-§8, §10).
// Single CLI entry point agents call. Zero dependencies, Node.js stdlib only,
// no network use. Plain text to stdout, errors to stderr, non-zero exit on
// failure. Atomic writes everywhere (temp file + rename).
//
// Usage: node scripts/memory.js <command> [args] [--dir <path>]
//   context | search | save | get | list | update | delete |
//   lesson-add | lesson-check | journal-start | journal-note | journal-close |
//   index [--stale]
//   --path | --export | --version

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const lessons = require('./lessons');
const journal = require('./journal');

const VERSION = '1.3.0';

const CATEGORIES = [
  'user',
  'preference',
  'project',
  'decision',
  'lesson',
  'fact',
  'episodic',
  'other',
];

const SOURCES = ['user', 'tool-output', 'file-path', 'url', 'session'];
const CONFIDENCES = ['verified', 'user_stated', 'inferred'];

// Spec §4 layout. Decisions and episodic notes share 02_episodic (session
// summaries, decisions, work logs); durable project/fact/other knowledge
// shares 03_semantic; user + preference share 01_user-profile.
const CATEGORY_DIR = {
  user: '01_user-profile',
  preference: '01_user-profile',
  episodic: '02_episodic',
  decision: '02_episodic',
  project: '03_semantic',
  fact: '03_semantic',
  other: '03_semantic',
  lesson: '04_procedural-lessons',
};
const ENTRY_DIRS = ['01_user-profile', '02_episodic', '03_semantic', '04_procedural-lessons'];
const JOURNAL_DIR = '05_thinking-journal';
const ROUTER_FILE = '00_MEMORY_ROUTER.md';
const INDEX_FILE = 'index.json';

// Spec §5 tier weights.
const TIER_WEIGHT = {
  lesson: 1.6,
  user: 1.5,
  preference: 1.4,
  decision: 1.2,
  project: 1.1,
  fact: 1.0,
  episodic: 0.9,
  other: 0.8,
};

// Category priority for `context` (spec §5).
const CATEGORY_PRIORITY = [
  'user',
  'preference',
  'project',
  'decision',
  'lesson',
  'fact',
  'episodic',
  'other',
];

// BM25-lite defaults (spec §5).
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RECENCY_HALF_LIFE_DAYS = 60;
const PHRASE_BONUS = 2.0;
const BODY_MAX_CHARS = 2000;
const ROUTER_MAX_LINES = 40;
const STALE_MIN_AGE_DAYS = 180;

const STOPWORDS = new Set([
  // English common words.
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its',
  'this', 'that', 'these', 'those', 'at', 'by', 'from', 'as',
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'having',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'not', 'no', 'nor', 'so', 'if', 'but',
  'what', 'how', 'when', 'where', 'why', 'which', 'who', 'whom',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'just', 'about', 'into', 'over', 'after', 'before', 'between', 'through',
  'during', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'too', 'very', 'now', 'than', 'also',
  'per', 'via',
  // Vietnamese common words.
  'và', 'hoặc', 'của', 'cho', 'với', 'là', 'các', 'những', 'một',
  'trong', 'trên', 'dưới', 'từ', 'đến', 'đã', 'đang', 'sẽ', 'không',
  'có', 'được', 'bị', 'thì', 'mà', 'này', 'đó', 'kia', 'khi', 'nếu',
  'vì', 'để', 'về', 'theo', 'tại', 'bằng', 'như', 'hơn', 'nhất', 'rất',
  'cũng', 'còn', 'rồi', 'nữa', 'chỉ', 'mỗi', 'anh', 'em', 'tôi', 'bạn',
  'mình', 'chúng', 'họ', 'người', 'cái', 'việc', 'thế', 'nên', 'ra',
  'vào', 'lên', 'xuống', 'qua', 'giữa', 'sau', 'trước', 'ngoài', 'cùng',
  'nhiều', 'ít', 'lại', 'vẫn', 'đều', 'mọi', 'cả', 'tất',
]);

const BOOLEAN_FLAGS = new Set(['stale', 'help', 'version', 'path', 'export', 'open', 'dry-run']);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return [
    'usage: node scripts/memory.js <command> [args] [--dir <path>]',
    '  context [--max-items N]            print router + top entries (default 30)',
    '  search <query> [--limit N] [--category C] [--after DATE] [--before DATE]',
    '  save --content "..." [--category C] [--tags a,b] [--source S] [--confidence C] [--importance N]',
    '  get <id>',
    '  list [--category C] [--limit N]    (default limit 50)',
    '  update <id> [--content ...] [--tags ...] [--importance N]',
    '  delete <id>',
    '  lesson-add --title ... --what ... --why ... --where ... --lesson ... --trigger ... --prevention ... [--signature "s1,s2"] [--tags a,b] [--importance N]',
    '  lesson-check <error-or-situation-text>',
    '  journal-start --slug ... --goal ... --criteria ... [--options ...]',
    '  journal-note --slug ... --note ...',
    '  journal-close --slug ... --outcome ... [--lesson <lesson-id>]',
    '  journal-list [--open]              list journals (--open: only unclosed ones)',
    '  prune-skeletons [--dry-run]        delete unfilled session-stop skeleton entries',
    '  prune-noise [--dry-run]            remove or clean entries containing AI refusal boilerplate',
    '  index [--stale]                    rebuild index + router, or list stale candidates',
    '  --path                             print the resolved store path',
    '  --export                           print the whole store as JSON',
    '  --version                          print version ' + VERSION,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

// Splits argv into a command, positionals, and --flags (both --f v and
// --f=v forms). Flags are recorded only when present, so callers can tell
// "flag given" apart from "default applies".
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') {
      for (let j = i + 1; j < argv.length; j++) {
        positionals.push(argv[j]);
      }
      break;
    }
    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      if (!name) {
        fail('bad flag: ' + tok);
      }
      if (BOOLEAN_FLAGS.has(name)) {
        if (eq !== -1) {
          fail('flag --' + name + ' takes no value');
        }
        flags[name] = true;
        continue;
      }
      if (eq !== -1) {
        flags[name] = body.slice(eq + 1);
      } else {
        if (i + 1 >= argv.length) {
          fail('missing value for flag --' + name);
        }
        flags[name] = argv[i + 1];
        i++;
      }
      continue;
    }
    if (command === null) {
      command = tok;
    } else {
      positionals.push(tok);
    }
  }
  return { command, positionals, flags };
}

function parsePositiveInt(raw, name, fallback) {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    fail('invalid ' + name + ': ' + raw + ' (expected a positive integer)');
  }
  const n = parseInt(raw, 10);
  if (n < 1) {
    fail('invalid ' + name + ': ' + raw + ' (expected a positive integer)');
  }
  return n;
}

function parseImportance(raw, fallback) {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^[1-5]$/.test(raw)) {
    fail('invalid importance: ' + raw + ' (expected an integer 1..5)');
  }
  return parseInt(raw, 10);
}

// Parse a date/datetime string for --after / --before filters.
// Returns ms-since-epoch, or fails with a clear message on bad input.
function parseDate(raw, name) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    fail('invalid date for ' + name + ': ' + JSON.stringify(raw) + ' (expected YYYY-MM-DD or ISO 8601)');
  }
  return d.getTime();
}

function parseTags(raw) {
  if (raw === undefined || raw === '') {
    return [];
  }
  return raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
}

function requireFlag(flags, name) {
  const v = flags[name];
  if (v === undefined || String(v).trim() === '') {
    fail('missing required flag --' + name);
  }
  return String(v);
}

function validateCategory(value) {
  if (!CATEGORIES.includes(value)) {
    fail('invalid category: ' + value + ' (expected one of: ' + CATEGORIES.join(', ') + ')');
  }
  return value;
}

function validateEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    fail('invalid ' + name + ': ' + value + ' (expected one of: ' + allowed.join(', ') + ')');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Store resolution and atomic I/O
// ---------------------------------------------------------------------------

// Spec §4 order: --dir > AGMEM_DIR > <cwd>/.agents/memory (only when a
// .agents/ directory exists in cwd) > $HOME/.antigravity-memory.
function resolveStorePath(dirFlag) {
  if (dirFlag) {
    return path.resolve(dirFlag);
  }
  if (process.env.AGMEM_DIR) {
    return path.resolve(process.env.AGMEM_DIR);
  }
  const agentsDir = path.join(process.cwd(), '.agents');
  try {
    if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
      return path.join(agentsDir, 'memory');
    }
  } catch (err) {
    // Fall through to the HOME default.
  }
  return path.join(os.homedir(), '.antigravity-memory');
}

function ensureStore(store) {
  fs.mkdirSync(store, { recursive: true });
  for (const dir of ENTRY_DIRS.concat([JOURNAL_DIR])) {
    fs.mkdirSync(path.join(store, dir), { recursive: true });
  }
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + '.tmp'
  );
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (ignored) {
      // Temp cleanup is best-effort.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Entry frontmatter (YAML subset, no dependency)
// ---------------------------------------------------------------------------

function yamlValue(value) {
  const s = String(value == null ? '' : value);
  if (s === '') {
    return '""';
  }
  if (/^[A-Za-z0-9][A-Za-z0-9 _\-./]*$/.test(s)) {
    return s;
  }
  return JSON.stringify(s);
}

function parseYamlScalar(raw) {
  const s = String(raw).trim();
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch (err) {
      return s.replace(/^"|"$/g, '');
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}

function serializeEntry(entry) {
  const lines = [
    '---',
    'id: ' + entry.id,
    'category: ' + entry.category,
    'tags: [' + entry.tags.map(yamlValue).join(', ') + ']',
    'source: ' + yamlValue(entry.source),
    'confidence: ' + entry.confidence,
    'importance: ' + entry.importance,
    'created_at: ' + yamlValue(entry.created_at),
    'updated_at: ' + yamlValue(entry.updated_at),
    'access_count: ' + entry.access_count,
    'error_signature: ' + yamlValue(entry.error_signature || ''),
    'trigger: ' + yamlValue(entry.trigger || ''),
    'prevention_check: ' + yamlValue(entry.prevention_check || ''),
    '---',
    '',
    entry.body,
    '',
  ];
  return lines.join('\n');
}

// Parse one entry file. Returns { entry } or { error } — callers warn and
// skip on error, never crash the whole command (spec §8).
function parseEntryFile(filePath, relFile) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { error: 'cannot read: ' + err.message };
  }
  const lines = raw.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { error: 'missing frontmatter' };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { error: 'unterminated frontmatter' };
  }
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') {
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) {
      return { error: 'bad frontmatter line: ' + line };
    }
    const key = m[1];
    const val = m[2].trim();
    if (key === 'tags') {
      if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1).trim();
        fm.tags = inner === ''
          ? []
          : inner.split(',').map((t) => parseYamlScalar(t.trim()));
      } else {
        fm.tags = val === '' ? [] : [parseYamlScalar(val)];
      }
    } else {
      fm[key] = parseYamlScalar(val);
    }
  }
  const entry = {
    id: fm.id,
    category: fm.category,
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    source: fm.source,
    confidence: fm.confidence,
    importance: fm.importance,
    created_at: fm.created_at,
    updated_at: fm.updated_at,
    access_count: fm.access_count,
    error_signature: fm.error_signature == null ? '' : String(fm.error_signature),
    trigger: fm.trigger == null ? '' : String(fm.trigger),
    prevention_check: fm.prevention_check == null ? '' : String(fm.prevention_check),
    body: lines.slice(end + 1).join('\n').trim(),
    file: relFile,
  };
  if (typeof entry.id !== 'string' || !/^m_[0-9a-f]{10}$/.test(entry.id)) {
    return { error: 'invalid or missing id' };
  }
  if (!CATEGORIES.includes(entry.category)) {
    return { error: 'invalid or missing category' };
  }
  if (!/^[1-5]$/.test(String(entry.importance))) {
    return { error: 'invalid or missing importance' };
  }
  entry.importance = parseInt(entry.importance, 10);
  if (!/^\d+$/.test(String(entry.access_count))) {
    return { error: 'invalid or missing access_count' };
  }
  entry.access_count = parseInt(entry.access_count, 10);
  if (typeof entry.created_at !== 'string' || entry.created_at === '') {
    return { error: 'missing created_at' };
  }
  if (typeof entry.updated_at !== 'string' || entry.updated_at === '') {
    return { error: 'missing updated_at' };
  }
  if (typeof entry.source !== 'string' || entry.source === '') {
    entry.source = 'user';
  }
  if (typeof entry.confidence !== 'string' || entry.confidence === '') {
    entry.confidence = 'inferred';
  }
  try {
    entry.fileMtimeMs = fs.statSync(filePath).mtimeMs;
  } catch (err) {
    entry.fileMtimeMs = 0;
  }
  return { entry };
}

// Load every entry from the 01-04 dirs. Files whose names start with "_"
// or "." are example/template files and are skipped silently; corrupt files
// are skipped with a stderr warning. Journals (05_*) are not entries and are
// never scanned here.
function loadEntries(store) {
  const entries = [];
  for (const dirName of ENTRY_DIRS) {
    const dir = path.join(store, dirName);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (err) {
      continue;
    }
    files.sort();
    for (const name of files) {
      if (name.startsWith('_') || name.startsWith('.')) {
        continue;
      }
      if (!name.endsWith('.md')) {
        continue;
      }
      const filePath = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (err) {
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      const relFile = dirName + '/' + name;
      const parsed = parseEntryFile(filePath, relFile);
      if (parsed.error) {
        process.stderr.write(
          'warning: skipping corrupt entry file ' + relFile + ': ' + parsed.error + '\n'
        );
        continue;
      }
      entries.push(parsed.entry);
    }
  }
  return entries;
}

function findEntry(entries, id) {
  return entries.find((e) => e.id === id) || null;
}

// Normalized body for duplicate detection: lowercase, collapse whitespace.
function normalizeBody(body) {
  return String(body).toLowerCase().replace(/\s+/g, ' ').trim();
}

function newId() {
  return 'm_' + crypto.randomBytes(5).toString('hex');
}

function entryFilePath(store, entry) {
  return path.join(store, entry.file);
}

function writeEntry(store, entry) {
  atomicWrite(entryFilePath(store, entry), serializeEntry(entry));
}

function publicEntry(entry) {
  return {
    id: entry.id,
    file: entry.file,
    category: entry.category,
    tags: entry.tags,
    source: entry.source,
    confidence: entry.confidence,
    importance: entry.importance,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    access_count: entry.access_count,
    error_signature: entry.error_signature,
    trigger: entry.trigger,
    prevention_check: entry.prevention_check,
    body: entry.body,
  };
}

// ---------------------------------------------------------------------------
// Retrieval (spec §5)
// ---------------------------------------------------------------------------

// Tokenize: lowercase, split on non-alphanumeric (Unicode-aware, so
// Vietnamese letters stay intact), drop tokens shorter than 2 chars and
// stopwords (EN + VI).
function tokenize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => [...t].length >= 2 && !STOPWORDS.has(t));
}

function docTokens(entry) {
  return tokenize(entry.body + ' ' + entry.tags.join(' '));
}

// A query token matches a doc token when equal, or (for query tokens of
// length >= 3) when the doc token starts with the query token. Two-character
// query tokens match exactly only: prefix matching on them is too noisy
// (e.g. "ai" would match "aim", "aid", ...). Coordinator refinement of spec
// §5, following the math model's noise note.
function tokenMatches(docToken, queryToken) {
  if (docToken === queryToken) {
    return true;
  }
  return [...queryToken].length >= 3 && docToken.startsWith(queryToken);
}

function normalizeText(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function entryTimestamp(entry) {
  const ts = Date.parse(entry.updated_at);
  if (!Number.isNaN(ts)) {
    return ts;
  }
  return entry.fileMtimeMs || 0;
}

// BM25-lite with tier weights, importance factor, recency bonus and phrase
// bonus, exactly as specified in §5. A query token matches a doc token when
// equal or (query tokens of length >= 3) when the doc token starts with it.
// Only entries with a BM25 hit or a phrase hit are returned.
function scoreEntries(entries, query) {
  const queryNorm = normalizeText(query);
  const queryTokens = [];
  for (const t of tokenize(query)) {
    if (!queryTokens.includes(t)) {
      queryTokens.push(t);
    }
  }
  const docs = entries.map((entry) => ({ entry, tokens: docTokens(entry) }));
  const n = docs.length;
  const avgdl = n === 0
    ? 0
    : docs.reduce((sum, d) => sum + d.tokens.length, 0) / n;
  const now = Date.now();

  // Document frequency per query token (prefix match counts).
  const dfByToken = new Map();
  for (const q of queryTokens) {
    let df = 0;
    for (const d of docs) {
      if (d.tokens.some((t) => tokenMatches(t, q))) {
        df++;
      }
    }
    dfByToken.set(q, df);
  }

  const results = [];
  for (const d of docs) {
    let bm25 = 0;
    let matched = 0;
    for (const q of queryTokens) {
      let tf = 0;
      for (const t of d.tokens) {
        if (tokenMatches(t, q)) {
          tf++;
        }
      }
      if (tf > 0) {
        matched++;
      } else {
        continue;
      }
      const df = dfByToken.get(q);
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = avgdl > 0
        ? tf + BM25_K1 * (1 - BM25_B + BM25_B * (d.tokens.length / avgdl))
        : tf + BM25_K1;
      bm25 += idf * ((tf * (BM25_K1 + 1)) / denom);
    }
    const contentNorm = normalizeText(d.entry.body + ' ' + d.entry.tags.join(' '));
    const phrase = queryNorm !== '' && contentNorm.indexOf(queryNorm) !== -1;
    if (bm25 <= 0 && !phrase) {
      continue;
    }
    const tier = TIER_WEIGHT[d.entry.category] || 0.8;
    const importanceFactor = 0.7 + 0.3 * (d.entry.importance / 5);
    const ageDays = Math.max(0, (now - entryTimestamp(d.entry)) / 86400000);
    const recency = 0.5 * Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
    const phraseBonus = phrase ? PHRASE_BONUS : 0;
    const score = bm25 * tier * importanceFactor + recency + phraseBonus;
    results.push({
      entry: d.entry,
      score,
      matched,
      total: queryTokens.length,
      phrase,
    });
  }
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.entry.importance !== a.entry.importance) {
      return b.entry.importance - a.entry.importance;
    }
    return entryTimestamp(b.entry) - entryTimestamp(a.entry);
  });
  return { results, queryTokens };
}

function firstLine(body, maxChars) {
  const line = String(body).split('\n').find((l) => l.trim() !== '') || '';
  const flat = line.replace(/\s+/g, ' ').trim();
  if (flat.length > maxChars) {
    return flat.slice(0, maxChars - 3) + '...';
  }
  return flat;
}

// For lesson entries, the body is a 7-line Title/What/Why/Where/Lesson/
// Trigger/Prevention layout, so firstLine() would show only the title and
// hide exactly the parts that prevent a repeated mistake. Snippets for
// lessons therefore show the Lesson + Prevention lines instead, capped at
// 400 characters so a search/context listing stays within budget. Falls
// back to firstLine() when the body has no such lines.
function lessonActionSnippet(entry) {
  const pick = (label) => {
    const line = String(entry.body).split('\n').find((l) => l.startsWith(label + ': '));
    if (!line) return '';
    return line.slice(label.length + 2).replace(/\s+/g, ' ').trim();
  };
  const parts = [];
  const lesson = pick('Lesson');
  const prevention = pick('Prevention');
  if (lesson !== '') parts.push('Lesson: ' + lesson);
  if (prevention !== '') parts.push('Prevention: ' + prevention);
  const flat = parts.join(' | ');
  if (flat === '') return firstLine(entry.body, 300);
  if (flat.length > 400) return flat.slice(0, 397) + '...';
  return flat;
}

function sortByImportanceRecency(a, b) {
  if (b.importance !== a.importance) {
    return b.importance - a.importance;
  }
  return entryTimestamp(b) - entryTimestamp(a);
}

function lessonTriggerText(entry) {
  if (entry.trigger && entry.trigger.trim() !== '') {
    return entry.trigger;
  }
  const m = entry.body.match(/^Trigger:\s*(.+)$/m);
  if (m) {
    return m[1].trim();
  }
  return firstLine(entry.body, 100);
}

function lessonTitleText(entry) {
  const m = entry.body.match(/^Title:\s*(.+)$/m);
  if (m) {
    return m[1].trim();
  }
  return firstLine(entry.body, 100);
}

// ---------------------------------------------------------------------------
// Router (spec §4): GENERATED, max 40 lines, sections in spec order.
// Per-section caps sum to 34 content lines + 6 header lines = 40 max.
// ---------------------------------------------------------------------------

function buildRouterLines(entries) {
  const byCategory = (cats) => entries
    .filter((e) => cats.includes(e.category))
    .sort(sortByImportanceRecency);
  const userEntries = byCategory(['user', 'preference']).slice(0, 8);
  const projectEntries = byCategory(['project']).slice(0, 6);
  const decisionEntries = byCategory(['decision']).slice(0, 6);
  const lessonEntries = byCategory(['lesson']).slice(0, 10);
  const threadEntries = byCategory(['episodic']).slice(0, 4);

  const lines = ['# Memory Router'];
  lines.push('## User');
  for (const e of userEntries) {
    lines.push('- ' + firstLine(e.body, 120) + ' (' + e.id + ')');
  }
  lines.push('## Active projects');
  for (const e of projectEntries) {
    lines.push('- ' + firstLine(e.body, 120) + ' (' + e.id + ')');
  }
  lines.push('## Key decisions');
  for (const e of decisionEntries) {
    lines.push('- ' + firstLine(e.body, 120) + ' (' + e.id + ')');
  }
  lines.push('## Lessons -- triggers');
  for (const e of lessonEntries) {
    lines.push('- ' + lessonTriggerText(e) + ' -> ' + e.file);
  }
  lines.push('## Open threads');
  for (const e of threadEntries) {
    lines.push('- ' + firstLine(e.body, 120) + ' (' + e.id + ')');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Index (spec §5)
// ---------------------------------------------------------------------------

// Read the previous index's last_accessed_at values (id -> ISO string), if
// any. Index rebuilds must preserve them: they are the only record of when
// an entry was last surfaced, and the entry files themselves carry no
// last-access timestamp.
function readPrevAccess(store) {
  const access = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(store, INDEX_FILE), 'utf8'));
    const records = Array.isArray(parsed) ? parsed : parsed.entries;
    if (Array.isArray(records)) {
      for (const r of records) {
        if (r && typeof r.id === 'string' && typeof r.last_accessed_at === 'string') {
          access.set(r.id, r.last_accessed_at);
        }
      }
    }
  } catch (err) {
    // No usable previous index; callers treat access as unknown.
  }
  return access;
}

function buildIndex(entries, prevAccess) {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    entries: entries.map((e) => ({
      id: e.id,
      file: e.file,
      category: e.category,
      tags: e.tags,
      tokens: [...new Set(docTokens(e))].sort(),
      importance: e.importance,
      updated_at: e.updated_at,
      access_count: e.access_count,
      error_signature: e.error_signature || '',
      last_accessed_at: prevAccess && prevAccess.has(e.id) ? prevAccess.get(e.id) : null,
    })),
  };
}

function writeIndex(store, entries) {
  atomicWrite(
    path.join(store, INDEX_FILE),
    JSON.stringify(buildIndex(entries, readPrevAccess(store)), null, 2) + '\n'
  );
}

// Write both index.json AND the router file. Called after every mutation
// (save, update, delete, lesson-add) so the router file on disk is always
// fresh for the next SessionStart hook — which reads it to build the briefing.
function writeIndexAndRouter(store, entries) {
  writeIndex(store, entries);
  const routerLines = buildRouterLines(entries);
  atomicWrite(path.join(store, ROUTER_FILE), routerLines.join('\n') + '\n');
}

// Record that the given entry ids were surfaced to the agent right now.
// Updates index.json only (never entry files, to avoid write churn on reads).
// Failures here must never break a read command.
function noteAccess(store, ids) {
  if (ids.length === 0) {
    return;
  }
  try {
    const indexPath = path.join(store, INDEX_FILE);
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const records = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(records)) {
      return;
    }
    const wanted = new Set(ids);
    const now = new Date().toISOString();
    let changed = false;
    for (const r of records) {
      if (wanted.has(r.id)) {
        r.last_accessed_at = now;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(indexPath, JSON.stringify(data, null, 2) + '\n');
    }
  } catch (err) {
    // Access tracking is best-effort; ignore.
  }
}

// Load entries from files (source of truth) and rewrite index.json when it
// is missing, has a different entry count, or predates any entry file.
// Search therefore works even with no index at all.
function ensureIndexFresh(store) {
  const entries = loadEntries(store);
  const indexPath = path.join(store, INDEX_FILE);
  let stale = false;
  if (!fs.existsSync(indexPath)) {
    stale = true;
  } else {
    try {
      const indexMtime = fs.statSync(indexPath).mtimeMs;
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const count = Array.isArray(parsed)
        ? parsed.length
        : (parsed.entries ? parsed.entries.length : -1);
      if (count !== entries.length) {
        stale = true;
      } else if (entries.some((e) => e.fileMtimeMs > indexMtime)) {
        stale = true;
      }
    } catch (err) {
      stale = true;
    }
  }
  if (stale) {
    writeIndex(store, entries);
  }
  return entries;
}

// Forgetting policy (spec §10): list only, NEVER delete. Candidates are
// importance <= 2 whose last access (index last_accessed_at, falling back
// to created_at for never-surfaced entries) is older than 180 days.
// Entries with confidence user_stated and importance >= 4 are never flagged
// (explicit guard, even though that combination cannot satisfy importance
// <= 2). Coordinator amendment: the entry schema (§4) carries no
// last-access timestamp, so last access lives in index.json records and is
// refreshed by search/context/get via noteAccess().
function staleCandidates(entries, accessMap) {
  const now = Date.now();
  return entries
    .filter((e) => {
      if (e.importance > 2) {
        return false;
      }
      if (e.confidence === 'user_stated' && e.importance >= 4) {
        return false;
      }
      const lastSeen = (accessMap && accessMap.get(e.id)) || e.created_at;
      const ts = Date.parse(lastSeen);
      if (Number.isNaN(ts)) {
        return false;
      }
      return (now - ts) / 86400000 > STALE_MIN_AGE_DAYS;
    })
    .sort(sortByImportanceRecency);
}

function printEntryFull(entry) {
  console.log('id: ' + entry.id);
  console.log('category: ' + entry.category);
  console.log('tags: ' + (entry.tags.length > 0 ? entry.tags.join(', ') : '(none)'));
  console.log('source: ' + entry.source);
  console.log('confidence: ' + entry.confidence);
  console.log('importance: ' + entry.importance);
  console.log('created_at: ' + entry.created_at);
  console.log('updated_at: ' + entry.updated_at);
  console.log('access_count: ' + entry.access_count);
  if (entry.error_signature) {
    console.log('error_signature: ' + entry.error_signature);
  }
  if (entry.trigger) {
    console.log('trigger: ' + entry.trigger);
  }
  if (entry.prevention_check) {
    console.log('prevention_check: ' + entry.prevention_check);
  }
  console.log('file: ' + entry.file);
  console.log('');
  console.log(entry.body);
}

function checkAndFailSecrets(text) {
  const found = lessons.checkSecrets(text);
  if (found.blocked) {
    fail(lessons.secretErrorMessage(found.pattern));
  }
}

// Strip any AI refusal/boilerplate lines from `text`, and refuse the write if
// the entire text (or what remains) is an AI refusal/apology sentence.
function sanitizeAndValidateRefusals(text) {
  const raw = String(text == null ? '' : text);
  const direct = lessons.checkRefusals(raw);
  const stripped = lessons.stripRefusalLines(raw);
  if (stripped === '') {
    const pattern = direct.pattern || 'ai-refusal-boilerplate';
    fail(lessons.refusalErrorMessage(pattern));
  }
  const remainingCheck = lessons.checkRefusals(stripped);
  if (remainingCheck.blocked) {
    fail(lessons.refusalErrorMessage(remainingCheck.pattern));
  }
  return stripped;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdContext(store, flags) {
  const maxItems = parsePositiveInt(flags['max-items'], '--max-items', 30);
  ensureStore(store);
  const entries = ensureIndexFresh(store);
  const routerPath = path.join(store, ROUTER_FILE);
  let routerLines;
  if (fs.existsSync(routerPath)) {
    routerLines = fs.readFileSync(routerPath, 'utf8').split('\n');
    while (routerLines.length > 0 && routerLines[routerLines.length - 1] === '') {
      routerLines.pop();
    }
  } else {
    routerLines = buildRouterLines(entries);
  }
  console.log(routerLines.join('\n'));
  console.log('');
  console.log('## Entries');
  const sorted = entries.slice().sort((a, b) => {
    const pa = CATEGORY_PRIORITY.indexOf(a.category);
    const pb = CATEGORY_PRIORITY.indexOf(b.category);
    if (pa !== pb) {
      return pa - pb;
    }
    return sortByImportanceRecency(a, b);
  });
  const shown = sorted.slice(0, maxItems);
  if (shown.length === 0) {
    console.log('(no entries yet)');
    return;
  }
  for (const e of shown) {
    console.log(
      '- ' + e.id + ' [' + e.category + ', importance ' + e.importance + ']'
      + ' tags: ' + (e.tags.length > 0 ? e.tags.join(', ') : '(none)')
    );
    console.log('  ' + (e.category === 'lesson' ? lessonActionSnippet(e) : firstLine(e.body, 300)));
  }
  noteAccess(store, shown.map((e) => e.id));
}

function cmdSearch(store, positionals, flags) {
  const query = positionals.join(' ').trim();
  if (query === '') {
    fail('search requires a query');
  }
  const limit = parsePositiveInt(flags.limit, '--limit', 8);
  const category = flags.category === undefined
    ? null
    : validateCategory(flags.category);
  ensureStore(store);
  let entries = ensureIndexFresh(store);
  if (category !== null) {
    entries = entries.filter((e) => e.category === category);
  }
  // Date-range filters: --after DATE and --before DATE (inclusive endpoints).
  if (flags.after !== undefined) {
    const afterMs = parseDate(flags.after, '--after');
    entries = entries.filter((e) => entryTimestamp(e) >= afterMs);
  }
  if (flags.before !== undefined) {
    const beforeMs = parseDate(flags.before, '--before');
    entries = entries.filter((e) => entryTimestamp(e) <= beforeMs);
  }
  const { results, queryTokens } = scoreEntries(entries, query);
  const shown = results.slice(0, limit);
  if (shown.length === 0) {
    console.log('no results for "' + query + '"');
    return;
  }
  shown.forEach((r, i) => {
    const coverage = r.total > 0
      ? r.matched + '/' + r.total
      : (r.phrase ? 'phrase' : '0/0');
    console.log(
      (i + 1) + '. ' + r.entry.id
      + ' score=' + r.score.toFixed(4)
      + ' coverage=' + coverage
      + ' [' + r.entry.category + ', importance ' + r.entry.importance + ']'
      + ' file=' + r.entry.file
    );
    console.log('   ' + (r.entry.category === 'lesson' ? lessonActionSnippet(r.entry) : firstLine(r.entry.body, 300)));
  });
  noteAccess(store, shown.map((r) => r.entry.id));
}

function cmdSave(store, flags) {
  const rawContent = requireFlag(flags, 'content');
  const category = validateCategory(flags.category === undefined ? 'fact' : flags.category);
  const source = validateEnum(
    flags.source === undefined ? 'user' : flags.source, SOURCES, 'source'
  );
  const confidence = validateEnum(
    flags.confidence === undefined ? 'inferred' : flags.confidence,
    CONFIDENCES, 'confidence'
  );
  const importance = parseImportance(flags.importance, 3);
  const tags = parseTags(flags.tags);
  checkAndFailSecrets(rawContent);
  const content = sanitizeAndValidateRefusals(rawContent);
  if (content.length > BODY_MAX_CHARS) {
    fail(
      'body is ' + content.length + ' characters, over the ' + BODY_MAX_CHARS
      + ' limit for ordinary entries; split it into smaller facts'
    );
  }
  ensureStore(store);
  const entries = loadEntries(store);
  const normalized = normalizeBody(content);
  const duplicate = entries.find((e) => normalizeBody(e.body) === normalized);
  const now = new Date().toISOString();
  if (duplicate) {
    const merged = [];
    for (const t of duplicate.tags.concat(tags)) {
      if (!merged.includes(t)) {
        merged.push(t);
      }
    }
    duplicate.tags = merged;
    if (flags.source !== undefined) {
      duplicate.source = source;
    }
    duplicate.updated_at = now;
    writeEntry(store, duplicate);
    const freshEntries = loadEntries(store);
    writeIndexAndRouter(store, freshEntries);
    console.log('duplicate: updated existing ' + duplicate.id + ' (content merged, no new file created)');
    return;
  }
  const entry = {
    id: newId(),
    category,
    tags,
    source,
    confidence,
    importance,
    created_at: now,
    updated_at: now,
    access_count: 0,
    error_signature: '',
    trigger: '',
    prevention_check: '',
    body: content,
    file: '',
  };
  // The filename must match the entry id.
  entry.file = CATEGORY_DIR[category] + '/' + entry.id + '.md';
  writeEntry(store, entry);
  const freshEntries2 = loadEntries(store);
  writeIndexAndRouter(store, freshEntries2);
  console.log('saved ' + entry.id + ' (' + category + ')');
}

function cmdGet(store, positionals) {
  const id = positionals[0];
  if (!id) {
    fail('get requires an id');
  }
  ensureStore(store);
  const entries = loadEntries(store);
  const entry = findEntry(entries, id);
  if (!entry) {
    fail('entry not found: ' + id);
  }
  entry.access_count += 1;
  writeEntry(store, entry);
  writeIndex(store, loadEntries(store));
  noteAccess(store, [entry.id]);
  printEntryFull(entry);
}

function cmdList(store, flags) {
  const limit = parsePositiveInt(flags.limit, '--limit', 50);
  const category = flags.category === undefined
    ? null
    : validateCategory(flags.category);
  ensureStore(store);
  let entries = loadEntries(store);
  if (category !== null) {
    entries = entries.filter((e) => e.category === category);
  }
  entries.sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
  const shown = entries.slice(0, limit);
  if (shown.length === 0) {
    console.log('(no entries)');
    return;
  }
  for (const e of shown) {
    console.log(
      e.id + ' | ' + e.category + ' | importance ' + e.importance
      + ' | tags: ' + (e.tags.length > 0 ? e.tags.join(', ') : '(none)')
      + ' | ' + firstLine(e.body, 100)
    );
  }
}

function cmdUpdate(store, positionals, flags) {
  const id = positionals[0];
  if (!id) {
    fail('update requires an id');
  }
  if (
    flags.content === undefined && flags.tags === undefined
    && flags.importance === undefined && flags.category === undefined
    && flags.confidence === undefined && flags.source === undefined
  ) {
    fail('update requires at least one of --content, --tags, --importance, --category, --confidence, --source');
  }
  ensureStore(store);
  const entries = loadEntries(store);
  const entry = findEntry(entries, id);
  if (!entry) {
    fail('entry not found: ' + id);
  }
  if (flags.content !== undefined) {
    checkAndFailSecrets(flags.content);
    const cleanContent = sanitizeAndValidateRefusals(flags.content);
    if (cleanContent.length > BODY_MAX_CHARS) {
      fail(
        'body is ' + cleanContent.length + ' characters, over the ' + BODY_MAX_CHARS
        + ' limit for ordinary entries; split it into smaller facts'
      );
    }
    entry.body = cleanContent;
  }
  if (flags.tags !== undefined) {
    entry.tags = parseTags(flags.tags);
  }
  if (flags.importance !== undefined) {
    entry.importance = parseImportance(flags.importance, entry.importance);
  }
  if (flags.category !== undefined) {
    const newCategory = validateCategory(flags.category);
    if (newCategory !== entry.category) {
      const oldPath = entryFilePath(store, entry);
      entry.category = newCategory;
      entry.file = CATEGORY_DIR[newCategory] + '/' + entry.id + '.md';
      try {
        fs.unlinkSync(oldPath);
      } catch (err) {
        // Old file removal is best-effort; the new file is authoritative.
      }
    }
  }
  if (flags.confidence !== undefined) {
    entry.confidence = validateEnum(flags.confidence, CONFIDENCES, 'confidence');
  }
  if (flags.source !== undefined) {
    entry.source = validateEnum(flags.source, SOURCES, 'source');
  }
  entry.updated_at = new Date().toISOString();
  writeEntry(store, entry);
  const updatedEntries = loadEntries(store);
  writeIndexAndRouter(store, updatedEntries);
  console.log('updated ' + entry.id);
}

function cmdDelete(store, positionals) {
  const id = positionals[0];
  if (!id) {
    fail('delete requires an id');
  }
  ensureStore(store);
  const entries = loadEntries(store);
  const entry = findEntry(entries, id);
  if (!entry) {
    fail('entry not found: ' + id);
  }
  fs.unlinkSync(entryFilePath(store, entry));
  const afterDelete = loadEntries(store);
  writeIndexAndRouter(store, afterDelete);
  console.log('deleted ' + id);
}

function cmdLessonAdd(store, flags) {
  const fields = {
    title: requireFlag(flags, 'title'),
    what: requireFlag(flags, 'what'),
    why: requireFlag(flags, 'why'),
    where: requireFlag(flags, 'where'),
    lesson: requireFlag(flags, 'lesson'),
    trigger: requireFlag(flags, 'trigger'),
    prevention: requireFlag(flags, 'prevention'),
  };
  const missing = lessons.validateLessonFields(fields);
  if (missing.length > 0) {
    fail('lesson-add missing required fields: ' + missing.join(', '));
  }
  const signature = lessons.normalizeSignature(flags.signature).join(', ');
  // Warn when no signature is given: the lesson will be saved but lesson-check
  // will never match it without substrings to match against.
  if (signature === '') {
    process.stderr.write(
      'warn: no --signature given; this lesson will not match lesson-check.\n' +
      '  Add --signature "keyword1,keyword2" to make it findable by error text.\n'
    );
  }
  const tags = parseTags(flags.tags);
  const importance = parseImportance(flags.importance, 4);
  checkAndFailSecrets(
    [fields.title, fields.what, fields.why, fields.where,
     fields.lesson, fields.trigger, fields.prevention, signature].join('\n')
  );
  fields.title = sanitizeAndValidateRefusals(fields.title);
  fields.what = sanitizeAndValidateRefusals(fields.what);
  fields.why = sanitizeAndValidateRefusals(fields.why);
  fields.lesson = sanitizeAndValidateRefusals(fields.lesson);
  fields.prevention = sanitizeAndValidateRefusals(fields.prevention);
  const body = lessons.buildLessonBody(fields);
  ensureStore(store);
  const entries = loadEntries(store);
  const normalized = normalizeBody(body);
  const duplicate = entries.find((e) => normalizeBody(e.body) === normalized);
  const now = new Date().toISOString();
  if (duplicate) {
    const merged = [];
    for (const t of duplicate.tags.concat(tags)) {
      if (!merged.includes(t)) {
        merged.push(t);
      }
    }
    duplicate.tags = merged;
    duplicate.updated_at = now;
    writeEntry(store, duplicate);
    const lessonDupEntries = loadEntries(store);
    writeIndexAndRouter(store, lessonDupEntries);
    console.log('duplicate: updated existing lesson ' + duplicate.id + ' (content merged, no new file created)');
    return;
  }
  const entry = {
    id: newId(),
    category: 'lesson',
    tags,
    source: 'session',
    confidence: 'verified',
    importance,
    created_at: now,
    updated_at: now,
    access_count: 0,
    error_signature: signature,
    trigger: fields.trigger,
    prevention_check: fields.prevention,
    body,
    file: '',
  };
  entry.file = CATEGORY_DIR.lesson + '/' + entry.id + '.md';
  writeEntry(store, entry);
  const lessonEntries = loadEntries(store);
  writeIndexAndRouter(store, lessonEntries);
  console.log('saved lesson ' + entry.id);
}

function cmdLessonCheck(store, positionals) {
  const text = positionals.join(' ').trim();
  if (text === '') {
    fail('lesson-check requires error-or-situation text');
  }
  ensureStore(store);
  const entries = ensureIndexFresh(store)
    .filter((e) => e.category === 'lesson');
  const scored = [];
  for (const e of entries) {
    const matched = lessons.matchLessonSignatures(e, text);
    if (matched.length > 0) {
      scored.push({ entry: e, matched });
    }
  }
  scored.sort((a, b) => {
    if (b.matched.length !== a.matched.length) {
      return b.matched.length - a.matched.length;
    }
    if (b.entry.importance !== a.entry.importance) {
      return b.entry.importance - a.entry.importance;
    }
    return entryTimestamp(b.entry) - entryTimestamp(a.entry);
  });
  if (scored.length === 0) {
    console.log('no lessons matched');
    return;
  }
  scored.forEach((s, i) => {
    console.log(
      (i + 1) + '. ' + s.entry.id
      + ' matches=' + s.matched.length
      + ' importance=' + s.entry.importance
      + ' file=' + s.entry.file
    );
    console.log('   title: ' + lessonTitleText(s.entry));
    console.log('   matched: ' + s.matched.join(', '));
    console.log('   trigger: ' + lessonTriggerText(s.entry));
    console.log('   prevention: ' + (s.entry.prevention_check || '(none recorded)'));
  });
}

function cmdJournalStart(store, flags) {
  const slug = journal.slugify(requireFlag(flags, 'slug'));
  if (slug === '') {
    fail('invalid slug: no usable characters');
  }
  const goal = requireFlag(flags, 'goal');
  const criteria = requireFlag(flags, 'criteria');
  ensureStore(store);
  const dir = path.join(store, JOURNAL_DIR);
  const date = journal.localDateStr(new Date());
  const filename = journal.journalFilename(date, slug);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) {
    fail('journal already exists: ' + JOURNAL_DIR + '/' + filename);
  }
  const content = journal.buildJournalContent({
    slug,
    date,
    goal,
    criteria,
    options: flags.options,
    hypotheses: flags.hypotheses,
    assumptions: flags.assumptions,
    verificationPlan: flags.plan,
  });
  atomicWrite(filePath, content);
  console.log('journal started: ' + JOURNAL_DIR + '/' + filename);
}

function cmdJournalNote(store, flags) {
  const slug = requireFlag(flags, 'slug');
  const rawNote = requireFlag(flags, 'note');
  checkAndFailSecrets(rawNote);
  const note = sanitizeAndValidateRefusals(rawNote);
  ensureStore(store);
  const dir = path.join(store, JOURNAL_DIR);
  const filePath = journal.findJournalFile(dir, slug);
  if (!filePath) {
    fail('journal not found for slug: ' + slug);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  atomicWrite(filePath, journal.appendProgressNote(content, note));
  console.log('journal note added: ' + JOURNAL_DIR + '/' + path.basename(filePath));
}

function cmdJournalClose(store, flags) {
  const slug = requireFlag(flags, 'slug');
  const rawOutcome = requireFlag(flags, 'outcome');
  checkAndFailSecrets(rawOutcome);
  const outcome = sanitizeAndValidateRefusals(rawOutcome);
  ensureStore(store);
  const dir = path.join(store, JOURNAL_DIR);
  const filePath = journal.findJournalFile(dir, slug);
  if (!filePath) {
    fail('journal not found for slug: ' + slug);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  atomicWrite(filePath, journal.closeJournal(content, outcome, flags.lesson));
  console.log('journal closed: ' + JOURNAL_DIR + '/' + path.basename(filePath));
}

// List thinking journals, optionally filtered to open (unclosed) ones.
// Files starting with '_' (templates) are always skipped.
function cmdJournalList(store, flags) {
  const openOnly = flags.open === true;
  ensureStore(store);
  const dir = path.join(store, JOURNAL_DIR);
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.'))
      .sort()
      .reverse();
  } catch (err) {
    console.log('(no journals yet)');
    return;
  }
  if (files.length === 0) {
    console.log('(no journals yet)');
    return;
  }
  let shown = 0;
  for (const f of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch (err) {
      continue;
    }
    const isOpen = /^Status: open$/m.test(content);
    if (openOnly && !isOpen) continue;
    const status = isOpen ? 'OPEN  ' : 'closed';
    // Extract goal line for a human-readable summary.
    const goalLine = journal.readSection(content, 'Goal');
    const goalSnippet = goalLine.length > 0
      ? goalLine.join(' ').replace(/\s+/g, ' ').trim().slice(0, 80)
      : '(no goal recorded)';
    console.log(status + ' | ' + f + ' | ' + goalSnippet);
    shown++;
  }
  if (shown === 0) {
    console.log(openOnly ? '(no open journals)' : '(no journals yet)');
  }
}

// Delete all unfilled session-stop skeleton entries from 02_episodic/.
// A skeleton is identified by: category=episodic, tags include 'skeleton',
// and body starts with 'SKELETON'. Use --dry-run to preview without deleting.
function cmdPruneSkeletons(store, flags) {
  const dryRun = flags['dry-run'] === true;
  ensureStore(store);
  const entries = loadEntries(store);
  const candidates = entries.filter((e) =>
    e.category === 'episodic' &&
    e.tags.includes('skeleton') &&
    e.body.startsWith('SKELETON')
  );
  if (candidates.length === 0) {
    console.log('prune-skeletons: 0 skeleton entries found');
    return;
  }
  for (const e of candidates) {
    if (dryRun) {
      console.log('[dry-run] would delete ' + e.id + ' (' + e.file + ')');
    } else {
      try {
        fs.unlinkSync(entryFilePath(store, e));
        console.log('deleted skeleton ' + e.id);
      } catch (err) {
        process.stderr.write('warning: could not delete ' + e.file + ': ' + err.message + '\n');
      }
    }
  }
  if (!dryRun) {
    const pruned = loadEntries(store);
    writeIndexAndRouter(store, pruned);
    console.log('prune-skeletons: removed ' + candidates.length + ' skeleton entr' +
      (candidates.length === 1 ? 'y' : 'ies'));
  } else {
    console.log('[dry-run] prune-skeletons: ' + candidates.length + ' would be removed (re-run without --dry-run to delete)');
  }
}

// Scan all entries for AI refusal / boilerplate sentences.
// - If an entry consists entirely of refusal text, delete the entry file.
// - If an entry has valid facts alongside refusal lines, strip the refusal lines.
function cmdPruneNoise(store, flags) {
  const dryRun = flags['dry-run'] === true;
  ensureStore(store);
  const entries = loadEntries(store);
  let deletedCount = 0;
  let cleanedCount = 0;

  for (const e of entries) {
    const hasRefusal = lessons.checkRefusals(e.body).blocked;
    if (!hasRefusal) continue;

    const stripped = lessons.stripRefusalLines(e.body);
    const stillRefusal = stripped === '' || lessons.checkRefusals(stripped).blocked;

    if (stillRefusal) {
      deletedCount++;
      if (dryRun) {
        console.log('[dry-run] would delete refusal entry ' + e.id + ' (' + e.file + ')');
      } else {
        try {
          fs.unlinkSync(entryFilePath(store, e));
          console.log('deleted refusal entry ' + e.id);
        } catch (err) {
          process.stderr.write('warning: could not delete ' + e.file + ': ' + err.message + '\n');
        }
      }
    } else if (stripped !== e.body) {
      cleanedCount++;
      if (dryRun) {
        console.log('[dry-run] would strip refusal lines from ' + e.id + ' (' + e.file + ')');
      } else {
        e.body = stripped;
        e.updated_at = new Date().toISOString();
        writeEntry(store, e);
        console.log('cleaned refusal lines from ' + e.id);
      }
    }
  }

  if (deletedCount === 0 && cleanedCount === 0) {
    console.log('prune-noise: 0 refusal/noise entries found');
    return;
  }

  if (!dryRun) {
    const fresh = loadEntries(store);
    writeIndexAndRouter(store, fresh);
    console.log(
      'prune-noise: deleted ' + deletedCount + ' entry/entries, cleaned ' + cleanedCount + ' entry/entries'
    );
  } else {
    console.log(
      '[dry-run] prune-noise: ' + deletedCount + ' would be deleted, ' + cleanedCount + ' would be cleaned'
    );
  }
}

function cmdIndex(store, flags) {
  ensureStore(store);
  const entries = loadEntries(store);
  if (flags.stale) {
    const accessMap = readPrevAccess(store);
    const candidates = staleCandidates(entries, accessMap);
    if (candidates.length === 0) {
      console.log('stale candidates: 0');
      return;
    }
    for (const e of candidates) {
      console.log(
        e.id + ' | importance ' + e.importance
        + ' | last_seen ' + (accessMap.get(e.id) || e.created_at)
        + ' | ' + firstLine(e.body, 100)
      );
    }
    console.log('stale candidates: ' + candidates.length);
    return;
  }
  const routerLines = buildRouterLines(entries);
  if (routerLines.length > ROUTER_MAX_LINES) {
    fail(
      'router truncation failed: ' + routerLines.length
      + ' lines exceeds the ' + ROUTER_MAX_LINES + ' line cap; refusing to write router'
    );
  }
  writeIndex(store, entries);
  atomicWrite(
    path.join(store, ROUTER_FILE),
    routerLines.join('\n') + '\n'
  );
  console.log('index: ' + entries.length + ' entries written to ' + INDEX_FILE);
  console.log('router: ' + routerLines.length + ' lines written to ' + ROUTER_FILE);
}

function cmdExport(store) {
  ensureStore(store);
  const entries = loadEntries(store);
  const routerPath = path.join(store, ROUTER_FILE);
  const router = fs.existsSync(routerPath)
    ? fs.readFileSync(routerPath, 'utf8')
    : null;
  const journalDir = path.join(store, JOURNAL_DIR);
  const journals = [];
  try {
    const files = fs.readdirSync(journalDir).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) {
      journals.push({
        file: JOURNAL_DIR + '/' + f,
        content: fs.readFileSync(path.join(journalDir, f), 'utf8'),
      });
    }
  } catch (err) {
    // No journals yet is fine.
  }
  const out = {
    store,
    generated_at: new Date().toISOString(),
    entries: entries.map(publicEntry),
    journals,
    router,
  };
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  const parsed = parseArgs(argv);
  const flags = parsed.flags;
  if (flags.help) {
    console.log(usage());
    return 0;
  }
  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  const dirFlag = flags.dir;
  const store = resolveStorePath(dirFlag);

  if (!parsed.command) {
    if (flags.path) {
      console.log(store);
      return 0;
    }
    if (flags.export) {
      cmdExport(store);
      return 0;
    }
    process.stderr.write(usage() + '\n');
    return 1;
  }

  const command = parsed.command;
  const positionals = parsed.positionals;
  switch (command) {
    case 'context':
      cmdContext(store, flags);
      break;
    case 'search':
      cmdSearch(store, positionals, flags);
      break;
    case 'save':
      cmdSave(store, flags);
      break;
    case 'get':
      cmdGet(store, positionals);
      break;
    case 'list':
      cmdList(store, flags);
      break;
    case 'update':
      cmdUpdate(store, positionals, flags);
      break;
    case 'delete':
      cmdDelete(store, positionals);
      break;
    case 'lesson-add':
      cmdLessonAdd(store, flags);
      break;
    case 'lesson-check':
      cmdLessonCheck(store, positionals);
      break;
    case 'journal-start':
      cmdJournalStart(store, flags);
      break;
    case 'journal-note':
      cmdJournalNote(store, flags);
      break;
    case 'journal-close':
      cmdJournalClose(store, flags);
      break;
    case 'journal-list':
      cmdJournalList(store, flags);
      break;
    case 'prune-skeletons':
      cmdPruneSkeletons(store, flags);
      break;
    case 'prune-noise':
      cmdPruneNoise(store, flags);
      break;
    case 'index':
      cmdIndex(store, flags);
      break;
    default:
      fail('unknown command: ' + command + '\n' + usage());
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write('error: ' + err.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { main, resolveStorePath, VERSION };
