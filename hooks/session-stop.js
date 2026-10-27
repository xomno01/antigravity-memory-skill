#!/usr/bin/env node
// antigravity-memory — Stop hook handler v1.2.0
//
// Creates ONE session-summary skeleton entry per day maximum.
// Skips entirely when the store has no real (non-skeleton) entries: there is
// nothing to summarise in an empty or trivially-opened session.
// After writing, spawns `memory.js index` in the background to keep the
// router file fresh for the next SessionStart briefing.
//
// Zero dependencies, Node.js >= 18 only.
// Contract: fast, non-interactive, ALWAYS exits 0 — even when the store is
// unwritable, stdin is garbage, or the background index spawn fails.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const STDIN_TIMEOUT_MS = 750;

// Dirs that hold real memory entries (mirrors ENTRY_DIRS in memory.js).
const ENTRY_DIRS = ['01_user-profile', '02_episodic', '03_semantic', '04_procedural-lessons'];

// Read stdin if present, tolerating anything (missing pipe, JSON payload,
// garbage). Returns the raw text, or '' when unreadable. Never blocks long.
function readStdinTolerant() {
  return new Promise((resolve) => {
    let done = false;
    let chunks = '';
    const finish = () => {
      if (done) return;
      done = true;
      // Destroy (not just pause): a paused pipe whose writer stays open
      // would keep the event loop alive indefinitely.
      try { process.stdin.destroy(); } catch (_) { /* ignore */ }
      resolve(chunks);
    };
    try {
      if (!process.stdin || process.stdin.isTTY) return finish();
      process.stdin.resume();
      process.stdin.on('data', (c) => {
        if (chunks.length < 4096) chunks += String(c).slice(0, 4096);
      });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      setTimeout(finish, STDIN_TIMEOUT_MS);
    } catch (_) {
      finish();
    }
  });
}

// Store resolution (spec §4 order).
function resolveStoreDir(argv) {
  const dirFlag = argv.indexOf('--dir');
  if (dirFlag !== -1 && argv[dirFlag + 1]) return argv[dirFlag + 1];
  if (process.env.AGMEM_DIR) return process.env.AGMEM_DIR;
  try {
    if (fs.existsSync(path.join(process.cwd(), '.agents'))) {
      return path.join(process.cwd(), '.agents', 'memory');
    }
  } catch (_) { /* fall through */ }
  // Support both Unix ($HOME) and Windows ($USERPROFILE) home directories.
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) return path.join(home, '.antigravity-memory');
  return null;
}

// Best-effort session id extraction from a hook payload.
function extractSessionId(raw) {
  if (!raw) return '';
  try {
    const payload = JSON.parse(raw);
    if (payload && typeof payload === 'object') {
      for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
        const value = payload[key];
        if (typeof value === 'string' && value.length > 0 && value.length <= 128) {
          return value;
        }
      }
    }
  } catch (_) { /* not JSON */ }
  return '';
}

// Returns true if the store contains at least one real (non-skeleton) entry.
// A file is considered real if it ends in .md, doesn't start with _ or .,
// and does NOT have both tags [session-summary, skeleton] in its content.
// We use a quick tag-line heuristic to avoid parsing full frontmatter.
function hasRealEntries(storeDir) {
  for (const dir of ENTRY_DIRS) {
    const dirPath = path.join(storeDir, dir);
    let files;
    try {
      files = fs.readdirSync(dirPath);
    } catch (_) { continue; }
    for (const f of files) {
      if (f.startsWith('_') || f.startsWith('.') || !f.endsWith('.md')) continue;
      try {
        // Read only the first 512 bytes — enough to check the frontmatter tags.
        const buf = Buffer.alloc(512);
        const fd = fs.openSync(path.join(dirPath, f), 'r');
        const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
        fs.closeSync(fd);
        const head = buf.slice(0, bytesRead).toString('utf8');
        // Skip skeleton files (tagged by session-stop itself).
        if (head.includes('skeleton')) continue;
        return true; // Found a real, non-skeleton entry.
      } catch (_) { continue; }
    }
  }
  return false;
}

function isoNow() {
  return new Date().toISOString();
}

function skeletonEntry(id, now, sessionId) {
  const sessionLine = sessionId
    ? 'Session: ' + sessionId + '\n'
    : 'Session: (unknown -- hook payload carried no session id)\n';
  return '---\n' +
    'id: ' + id + '\n' +
    'category: episodic\n' +
    'tags: [session-summary, skeleton]\n' +
    'source: session\n' +
    'confidence: inferred\n' +
    'importance: 2\n' +
    'created_at: ' + now + '\n' +
    'updated_at: ' + now + '\n' +
    'access_count: 0\n' +
    'error_signature: ""\n' +
    'trigger: ""\n' +
    'prevention_check: ""\n' +
    '---\n\n' +
    'SKELETON -- session summary, NOT YET COMPLETED BY THE AGENT.\n' +
    'The agent should complete the sections below on a later session if\n' +
    'this session turns out to matter; otherwise this skeleton may stay\n' +
    'as-is or be deleted via `prune-skeletons`. Do not treat TBD as facts.\n\n' +
    sessionLine +
    'Ended: ' + now + '\n\n' +
    '## Summary\nTBD\n\n' +
    '## Decisions\nTBD\n\n' +
    '## Open threads\nTBD\n\n' +
    '## Lesson links\nTBD\n';
}

// Spawn `memory.js index` detached so the router file is fresh for the next
// SessionStart. Best-effort: failures are silently ignored.
function spawnIndexRebuild(storeDir) {
  try {
    const skillDir = path.dirname(path.dirname(__filename));
    const cliPath = path.join(skillDir, 'scripts', 'memory.js');
    if (!fs.existsSync(cliPath)) return;
    const args = [cliPath, 'index'];
    if (storeDir) args.push('--dir', storeDir);
    const child = spawn(process.execPath, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.unref();
  } catch (_) { /* best-effort only */ }
}

async function main() {
  const raw = await readStdinTolerant();
  const sessionId = extractSessionId(raw);
  const storeDir = resolveStoreDir(process.argv.slice(2));
  if (!storeDir) return;

  // FIX #1a: Skip entirely if the store has no real entries.
  // An empty store means the session did nothing worth summarising.
  if (!hasRealEntries(storeDir)) return;

  const episodicDir = path.join(storeDir, '02_episodic');
  try {
    fs.mkdirSync(episodicDir, { recursive: true });
  } catch (_) {
    return;
  }

  // FIX #1b: One skeleton per calendar day maximum.
  // If one already exists for today, skip — no need for N identical skeletons.
  const date = isoNow().slice(0, 10);
  let existingToday = false;
  try {
    existingToday = fs.readdirSync(episodicDir)
      .some((f) => f.startsWith(date + '-session-summary-') && f.endsWith('.md'));
  } catch (_) { /* unreadable dir — fall through and try to write */ }
  if (existingToday) {
    // Router is already up-to-date; just ensure it is rebuilt in background.
    spawnIndexRebuild(storeDir);
    return;
  }

  // Write the skeleton. Exclusive create ('wx') guarantees no overwrite.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = 'm_' + crypto.randomBytes(5).toString('hex');
    const file = path.join(episodicDir, date + '-session-summary-' + id + '.md');
    try {
      fs.writeFileSync(file, skeletonEntry(id, isoNow(), sessionId), { flag: 'wx' });
      break;
    } catch (err) {
      if (err && err.code === 'EEXIST') continue;
      break; // Any other write error: degrade silently.
    }
  }

  // FIX #12: Rebuild router + index so the next SessionStart briefing is fresh.
  spawnIndexRebuild(storeDir);
}

main()
  .catch(() => { /* last-resort guard: never fail session stop */ })
  .finally(() => {
    process.exitCode = 0;
  });
