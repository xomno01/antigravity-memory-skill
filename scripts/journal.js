'use strict';

// Library module for thinking journals (spec §6).
// Used by scripts/memory.js (the CLI). Zero dependencies, Node.js stdlib only.
//
// Journal files live in <store>/05_thinking-journal/ as
// <YYYY-MM-DD>-<slug>.md. They are NOT memory entries: they carry no entry
// frontmatter and are never scanned as entries by the search index.

const fs = require('fs');
const path = require('path');

const JOURNAL_SECTIONS = [
  'Goal',
  'Acceptance criteria',
  'Hypotheses',
  'Options considered (and rejected, with reason)',
  'Assumptions',
  'Verification plan',
  'Progress notes',
  'Outcome',
  'Lesson link',
];

// Lowercase, collapse every run of non-alphanumerics into one dash.
function slugify(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Local calendar date (YYYY-MM-DD), not UTC, so the filename matches the
// agent's local day.
function localDateStr(d) {
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function journalFilename(dateStr, slug) {
  return dateStr + '-' + slug + '.md';
}

// Build the full journal file content for journal-start. All mandatory
// sections are present from the start; unfinished sections carry placeholders
// that journal-note / journal-close replace.
function buildJournalContent(opts) {
  const lines = [];
  lines.push('# Thinking Journal: ' + opts.slug);
  lines.push('Date: ' + opts.date);
  lines.push('Status: open');
  lines.push('');
  lines.push('## Goal');
  lines.push(opts.goal);
  lines.push('');
  lines.push('## Acceptance criteria');
  lines.push(opts.criteria);
  lines.push('');
  lines.push('## Hypotheses');
  lines.push(opts.hypotheses || '(not recorded yet)');
  lines.push('');
  lines.push('## Options considered (and rejected, with reason)');
  lines.push(opts.options || '(not recorded yet)');
  lines.push('');
  lines.push('## Assumptions');
  lines.push(opts.assumptions || '(not recorded yet)');
  lines.push('');
  lines.push('## Verification plan');
  lines.push(opts.verificationPlan || '(not recorded yet)');
  lines.push('');
  lines.push('## Progress notes');
  lines.push('(none yet)');
  lines.push('');
  lines.push('## Outcome');
  lines.push('(open)');
  lines.push('');
  lines.push('## Lesson link');
  lines.push('(none yet)');
  lines.push('');
  return lines.join('\n');
}

// Find the newest journal file for a slug (filenames sort by date prefix).
// Returns the full path, or null when no journal with that slug exists.
function findJournalFile(journalDir, slug) {
  const clean = slugify(slug);
  if (!clean) {
    return null;
  }
  if (!fs.existsSync(journalDir)) {
    return null;
  }
  const files = fs
    .readdirSync(journalDir)
    .filter((f) => f.endsWith('-' + clean + '.md'))
    .sort()
    .reverse();
  if (files.length === 0) {
    return null;
  }
  return path.join(journalDir, files[0]);
}

// Replace the body lines of one "## <title>" section with newBody (a string
// that may itself contain several lines). Other sections are untouched.
function replaceSection(content, title, newBody) {
  const lines = String(content).split('\n');
  const header = '## ' + title;
  const start = lines.findIndex((l) => l === header);
  if (start === -1) {
    const trimmed = String(content).replace(/\n+$/, '');
    return trimmed + '\n\n' + header + '\n' + newBody + '\n';
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  const result = before.concat(newBody.split('\n'), [''], after);
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Read the current body lines of one section (without the header).
function readSection(content, title) {
  const lines = String(content).split('\n');
  const header = '## ' + title;
  const start = lines.findIndex((l) => l === header);
  if (start === -1) {
    return [];
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end);
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
  }
  return body;
}

// Append a timestamped bullet to ## Progress notes, replacing the
// "(none yet)" placeholder on the first note.
function appendProgressNote(content, note) {
  const stamp = new Date().toISOString();
  const bullet = '- ' + stamp + ' ' + note;
  const existing = readSection(content, 'Progress notes');
  const filtered = existing.filter((l) => l.trim() !== '' && l !== '(none yet)');
  filtered.push(bullet);
  return replaceSection(content, 'Progress notes', filtered.join('\n'));
}

// Fill ## Outcome and ## Lesson link and flip Status to closed.
function closeJournal(content, outcome, lessonId) {
  let out = String(content).replace(/^Status: open$/m, 'Status: closed');
  if (!/^Status: /m.test(out)) {
    out = out.replace(/^# Thinking Journal:.*$/m, (m) => m + '\nStatus: closed');
  }
  out = replaceSection(out, 'Outcome', outcome);
  const link = lessonId ? 'lesson ' + lessonId : '(none)';
  out = replaceSection(out, 'Lesson link', link);
  return out;
}

module.exports = {
  JOURNAL_SECTIONS,
  slugify,
  localDateStr,
  journalFilename,
  buildJournalContent,
  findJournalFile,
  replaceSection,
  readSection,
  appendProgressNote,
  closeJournal,
};
