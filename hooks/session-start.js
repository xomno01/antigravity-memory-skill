#!/usr/bin/env node
// antigravity-memory — SessionStart hook handler v1.1.0
// Prints the memory router/context briefing to stdout so Antigravity can
// inject it at session start. Zero dependencies, Node.js >= 18 only.
// Contract: fast, non-interactive, ALWAYS exits 0 — even when the engine
// is missing, the store is unreadable, or the stdin payload is unexpected.
// Never throws to the caller; every failure degrades to a one-line notice.
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BRIEFING_CHARS = 12000;
const CLI_TIMEOUT_MS = 10000;
const STDIN_TIMEOUT_MS = 750;

// Read stdin if present, tolerating anything: no stdin, a closed pipe, a
// JSON payload, or garbage. Never blocks forever and never throws.
function readStdinTolerant() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // Destroy (not just pause): a paused pipe whose writer stays open
      // would keep the event loop alive indefinitely. The hook never
      // needs stdin again after this point.
      try { process.stdin.destroy(); } catch (_) { /* ignore */ }
      resolve();
    };
    try {
      if (!process.stdin || process.stdin.isTTY) return finish();
      process.stdin.resume();
      process.stdin.on('data', () => { /* payload is informational only */ });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      setTimeout(finish, STDIN_TIMEOUT_MS);
    } catch (_) {
      finish();
    }
  });
}

// Store resolution (spec §4 order): --dir flag (from our own argv, if the
// hook command ever passes one) > AGMEM_DIR > <cwd>/.agents/memory when a
// .agents/ directory exists in cwd > $HOME/.antigravity-memory.
// Returns null only when no home directory is available at all.
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

async function main() {
  // Tolerate any stdin payload; its content is not needed for the briefing.
  await readStdinTolerant();

  // This hook lives at <skill-dir>/hooks/session-start.js, so the engine
  // CLI is at <skill-dir>/scripts/memory.js, resolved relative to this file.
  const skillDir = path.dirname(path.dirname(__filename));
  const cliPath = path.join(skillDir, 'scripts', 'memory.js');

  if (!fs.existsSync(cliPath)) {
    // Engine not installed yet (another worker owns scripts/). Degrade
    // silently to a one-line notice — never fail the session start.
    process.stdout.write(
      'antigravity-memory: memory engine not installed yet ' +
      '(scripts/memory.js missing); skipping memory briefing.\n'
    );
    return;
  }

  const args = ['context'];
  const storeDir = resolveStoreDir(process.argv.slice(2));
  if (storeDir) args.push('--dir', storeDir);

  let result;
  try {
    result = spawnSync(process.execPath, [cliPath].concat(args), {
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_) {
    result = null;
  }

  const out = result && typeof result.stdout === 'string' ? result.stdout : '';
  if (result && result.status === 0 && out.trim() !== '') {
    process.stdout.write(
      out.length > MAX_BRIEFING_CHARS
        ? out.slice(0, MAX_BRIEFING_CHARS) +
          '\n[antigravity-memory: briefing truncated]\n'
        : out
    );
  } else {
    // Empty store, engine error, timeout — briefing is best-effort only.
    process.stdout.write(
      'antigravity-memory: no memory briefing available ' +
      '(store empty or engine unavailable).\n'
    );
  }
}

main()
  .catch(() => {
    // Last-resort guard: the hook must never fail session start.
    try {
      process.stdout.write('antigravity-memory: briefing unavailable.\n');
    } catch (_) { /* ignore */ }
  })
  .finally(() => {
    process.exitCode = 0;
  });
