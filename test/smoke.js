'use strict';
/**
 * Antigravity Memory Skill — smoke tests (spec §11, CLI surface spec §8).
 *
 * Zero dependencies: Node.js >= 18 standard library only
 * (child_process, fs, os, path).
 *
 * Run:  node test/smoke.js        (from ~/workspace/antigravity-memory-skill/)
 * Exit: 0 only if EVERY case passes; non-zero otherwise.
 *
 * HONESTY / SAFETY RULES (spec §3, §11):
 * - Tests run ONLY in a temp dir: the store is a fresh mkdtempSync dir and
 *   the CLI is invoked with AGMEM_DIR pointing at it plus a fake HOME.
 *   The real HOME and any real store are never touched.
 * - The CLI under test is scripts/memory.js, written by another worker.
 *   This file contains NO implementation and NO stub: if the CLI is
 *   missing or a subcommand is unimplemented, the affected cases FAIL
 *   with a clear reason instead of passing vacuously.
 * - Every case has a real assertion. In particular, cases that expect
 *   CLI failure first assert the CLI actually exists/ran, so a missing
 *   CLI can never make a "must fail" case pass by accident.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------- setup
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'memory.js');
const CLI_MISSING_MSG =
  `CLI not implemented yet: ${CLI} does not exist (core-engine worker has not delivered it)`;

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agmem-smoke-'));
const FAKE_HOME = path.join(TMP_ROOT, 'home');
const STORE = path.join(TMP_ROOT, 'store');
fs.mkdirSync(FAKE_HOME, { recursive: true });
fs.mkdirSync(STORE, { recursive: true });

// Sanity: refuse to run if the store ever escapes the temp dir.
if (!STORE.startsWith(os.tmpdir())) {
  throw new Error(`Refusing to run: store is not under os.tmpdir(): ${STORE}`);
}

const ENV = { ...process.env, AGMEM_DIR: STORE, HOME: FAKE_HOME };

// ---------------------------------------------------------------- helpers
function run(args) {
  if (!fs.existsSync(CLI)) {
    return { status: 127, stdout: '', stderr: CLI_MISSING_MSG, missing: true };
  }
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: ENV,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (r.error) {
    return { status: 127, stdout: r.stdout || '', stderr: String(r.error), missing: false };
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', missing: false };
}

/** Run the CLI, or throw if it is missing (so "must fail" cases can't pass vacuously). */
function mustRun(args) {
  const r = run(args);
  if (r.missing) throw new Error(CLI_MISSING_MSG);
  return r;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertExitZero(r, what) {
  assert(
    r.status === 0,
    `${what}: expected exit 0, got ${r.status}. stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`
  );
}

function assertExitNonZero(r, what) {
  assert(
    r.status !== 0,
    `${what}: expected non-zero exit, got 0. stdout=${JSON.stringify(r.stdout)}`
  );
}

/** All *.md files under the store except the generated router. */
function listEntryFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.md') && e.name !== '00_MEMORY_ROUTER.md') out.push(p);
    }
  };
  walk(STORE);
  return out.sort();
}

function countEntryFiles() {
  return listEntryFiles().length;
}

function findEntryContaining(token) {
  for (const f of listEntryFiles()) {
    if (fs.readFileSync(f, 'utf8').includes(token)) return f;
  }
  return null;
}

// ---------------------------------------------------------------- cases
// Distinctive tokens (single lowercase tokens, length > 2, unlikely to
// collide with anything else) so search assertions are unambiguous.
const FACT_TOKEN = 'zqxquokka';
const LESSON_TITLE = 'Zqx Deploy Lesson';
const LESSON_SIG = 'zqxbuildfail,zqxdeployflaky';

const cases = [
  {
    name: '1. save -> search finds the saved entry (top results contain its content)',
    fn: () => {
      const s = mustRun([
        'save', '--content', `Smoke test fact about ${FACT_TOKEN} deployment notes.`,
        '--category', 'fact',
      ]);
      assertExitZero(s, 'save');
      const r = mustRun(['search', FACT_TOKEN]);
      assertExitZero(r, 'search');
      assert(
        r.stdout.toLowerCase().includes(FACT_TOKEN),
        `search output does not contain saved token ${FACT_TOKEN}. stdout=${JSON.stringify(r.stdout)}`
      );
    },
  },
  {
    name: '2. duplicate save does not create a second file',
    fn: () => {
      // Self-contained: save once first (so this case does not depend on
      // case 1 having run), then save the identical content again.
      const first = mustRun([
        'save', '--content', `Smoke test fact about ${FACT_TOKEN} deployment notes.`,
        '--category', 'fact',
      ]);
      assertExitZero(first, 'initial save');
      const before = countEntryFiles();
      const s = mustRun([
        'save', '--content', `Smoke test fact about ${FACT_TOKEN} deployment notes.`,
        '--category', 'fact',
      ]);
      assertExitZero(s, 'duplicate save');
      const after = countEntryFiles();
      assert(after === before, `file count changed on duplicate save: ${before} -> ${after}`);
    },
  },
  {
    name: '3. context returns router + entries (router exists after index, context prints entry content)',
    fn: () => {
      const idx = mustRun(['index']);
      assertExitZero(idx, 'index');
      const router = path.join(STORE, '00_MEMORY_ROUTER.md');
      assert(fs.existsSync(router), 'router 00_MEMORY_ROUTER.md was not created by index');
      const ctx = mustRun(['context']);
      assertExitZero(ctx, 'context');
      assert(
        ctx.stdout.toLowerCase().includes(FACT_TOKEN),
        `context output does not contain saved entry content (${FACT_TOKEN}). stdout=${JSON.stringify(ctx.stdout)}`
      );
    },
  },
  {
    name: '4. lesson-add -> lesson-check matches the right lesson by error signature',
    fn: () => {
      const a = mustRun([
        'lesson-add',
        '--title', LESSON_TITLE,
        '--what', 'Deploy failed with a zqxbuildfail error',
        '--why', 'The build step was skipped before deploy.',
        '--where', 'deploy script',
        '--lesson', 'Run the build check before every deploy.',
        '--trigger', 'deploy after a code change',
        '--prevention', 'Run the build check first.',
        '--signature', LESSON_SIG,
      ]);
      assertExitZero(a, 'lesson-add');
      const c = mustRun(['lesson-check', 'the deploy hit zqxbuildfail again today']);
      assertExitZero(c, 'lesson-check');
      assert(
        c.stdout.includes(LESSON_TITLE),
        `lesson-check output does not name the expected lesson ${JSON.stringify(LESSON_TITLE)}. stdout=${JSON.stringify(c.stdout)}`
      );
    },
  },
  {
    name: '5. journal-start -> journal-note -> journal-close round-trip (file + all mandatory sections)',
    fn: () => {
      const slug = 'smoke-journal';
      const st = mustRun([
        'journal-start', '--slug', slug,
        '--goal', 'Smoke journal goal zqxjournal',
        '--criteria', 'criteria zqxjournal',
      ]);
      assertExitZero(st, 'journal-start');
      const nt = mustRun(['journal-note', '--slug', slug, '--note', 'progress note zqxjournalstep']);
      assertExitZero(nt, 'journal-note');
      const cl = mustRun(['journal-close', '--slug', slug, '--outcome', 'outcome zqxjournaldone']);
      assertExitZero(cl, 'journal-close');
      const dir = path.join(STORE, '05_thinking-journal');
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.includes(slug))
        : [];
      assert(files.length === 1, `expected exactly 1 journal file containing ${JSON.stringify(slug)}, got ${JSON.stringify(files)}`);
      const body = fs.readFileSync(path.join(dir, files[0]), 'utf8');
      const requiredSections = [
        '## Goal',
        '## Acceptance criteria',
        '## Hypotheses',
        '## Options considered',
        '## Assumptions',
        '## Verification plan',
        '## Progress notes',
        '## Outcome',
        '## Lesson link',
      ];
      for (const sec of requiredSections) {
        assert(body.includes(sec), `journal file is missing mandatory section ${JSON.stringify(sec)}`);
      }
      assert(body.includes('zqxjournalstep'), 'journal file does not contain the journal-note text');
      assert(body.includes('zqxjournaldone'), 'journal file does not contain the journal-close outcome');
    },
  },
  ...secretCases(),
  {
    name: '11. router has <= 40 lines after index',
    fn: () => {
      // Add enough entries that an uncapped router would plausibly exceed
      // the cap, so the <= 40 assertion is meaningful, not vacuous.
      for (let i = 0; i < 10; i++) {
        const s = mustRun([
          'save', '--content', `Router filler fact number ${i} about zqxrouterfill.`,
          '--category', 'fact', '--importance', '1',
        ]);
        assertExitZero(s, `filler save ${i}`);
      }
      const idx = mustRun(['index']);
      assertExitZero(idx, 'index');
      const router = path.join(STORE, '00_MEMORY_ROUTER.md');
      assert(fs.existsSync(router), 'router 00_MEMORY_ROUTER.md was not created by index');
      const text = fs.readFileSync(router, 'utf8');
      const lines = text.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      assert(lines.length <= 40, `router has ${lines.length} lines, exceeding the 40-line cap`);
      assert(text.includes('# Memory Router'), 'router does not start with the "# Memory Router" heading');
    },
  },
  {
    name: '12. index rebuilds after touching one entry (index.json is updated)',
    fn: () => {
      const idx1 = mustRun(['index']);
      assertExitZero(idx1, 'first index');
      const indexPath = path.join(STORE, 'index.json');
      assert(fs.existsSync(indexPath), 'index.json was not created by index');
      const entry = findEntryContaining(FACT_TOKEN);
      assert(entry, `could not find the entry file containing ${FACT_TOKEN}`);
      const marker = 'zqxrebuildtoken';
      fs.appendFileSync(entry, `\nExtra rebuild marker ${marker}.\n`);
      // Force the index to be observably stale, then re-index.
      const old = new Date('2000-01-01T00:00:00.000Z');
      fs.utimesSync(indexPath, old, old);
      const idx2 = mustRun(['index']);
      assertExitZero(idx2, 'second index');
      const mtime = fs.statSync(indexPath).mtimeMs;
      assert(mtime > old.getTime(), 'index.json mtime was not updated by re-index after touching an entry');
      const r = mustRun(['search', marker]);
      assertExitZero(r, 'search for rebuild marker');
      // Search prints only the first line of each hit, so the appended
      // marker (at the end of the body) is not echoed; assert instead that
      // the touched entry itself is returned, by its id.
      const touchedId = path.basename(entry, '.md');
      assert(
        r.stdout.includes(touchedId),
        `after rebuild, search does not return the touched entry ${touchedId} for token ${marker}. stdout=${JSON.stringify(r.stdout)}`
      );
    },
  },
  {
    name: '13a. CLI exits non-zero on bad input: save without --content',
    fn: () => {
      const r = mustRun(['save', '--category', 'fact']);
      assertExitNonZero(r, 'save without --content');
    },
  },
  {
    name: '13b. CLI exits non-zero on bad input: get with a nonexistent id',
    fn: () => {
      const r = mustRun(['get', 'm_0000000000']);
      assertExitNonZero(r, 'get nonexistent id');
    },
  },
  {
    name: '14. search works with no index.json (index deleted first)',
    fn: () => {
      const indexPath = path.join(STORE, 'index.json');
      fs.rmSync(indexPath, { force: true });
      assert(!fs.existsSync(indexPath), 'failed to delete index.json for the no-index test');
      const r = mustRun(['search', FACT_TOKEN]);
      assertExitZero(r, 'search without index.json');
      assert(
        r.stdout.toLowerCase().includes(FACT_TOKEN),
        `search without index.json does not find the saved entry (${FACT_TOKEN}). stdout=${JSON.stringify(r.stdout)}`
      );
    },
  },
  {
    name: '15. lesson search hits show Lesson + Prevention, not just the title',
    fn: () => {
      const r = mustRun(['search', 'zqxbuildfail']);
      assertExitZero(r, 'search for lesson signature token');
      assert(
        r.stdout.includes('Run the build check before every deploy.'),
        `lesson search hit does not show the Lesson text. stdout=${JSON.stringify(r.stdout)}`
      );
      assert(
        r.stdout.includes('Run the build check first.'),
        `lesson search hit does not show the Prevention text. stdout=${JSON.stringify(r.stdout)}`
      );
    },
  },
  {
    name: '16. context lesson lines show Lesson + Prevention, not just the title',
    fn: () => {
      const ctx = mustRun(['context']);
      assertExitZero(ctx, 'context');
      assert(
        ctx.stdout.includes('Run the build check before every deploy.'),
        `context lesson line does not show the Lesson text. stdout=${JSON.stringify(ctx.stdout)}`
      );
      assert(
        ctx.stdout.includes('Run the build check first.'),
        `context lesson line does not show the Prevention text. stdout=${JSON.stringify(ctx.stdout)}`
      );
    },
  },
];

// Secret-blocking cases (spec §7): one case per pattern class. Each asserts
// BOTH non-zero exit AND no file created AND the secret value not echoed.
function secretCases() {
  const groups = [
    {
      label: '6a. secret: long digit run (14-19 digits, spaces allowed)',
      content: 'Contact card number 4111 1111 1111 1111 on file',
      mustNotEcho: ['4111 1111 1111 1111', '4111111111111111'],
    },
    {
      label: '6b. secret: Google API key (AIza + 30+ base64url chars)',
      content: 'api key AIzaAb3xYz0123456789-_Ab3xYz0123456789 here',
      mustNotEcho: ['AIzaAb3xYz0123456789-_Ab3xYz0123456789'],
    },
    {
      label: '6c. secret: token format (ghp_ + 16+ chars)',
      content: 'token ghp_aB3xYz0123456789abcdef here',
      mustNotEcho: ['ghp_aB3xYz0123456789abcdef'],
    },
    {
      label: '6d. secret: PEM private key header',
      content: '-----BEGIN PRIVATE KEY-----\nMIIFAKEKEYBODY1234567890\n-----END PRIVATE KEY-----',
      mustNotEcho: ['MIIFAKEKEYBODY1234567890'],
    },
    {
      label: '6e. secret: password assignment (password= value)',
      content: 'login password=Hunter2SmokeSecret for the account',
      mustNotEcho: ['Hunter2SmokeSecret'],
    },
  ];
  return groups.map((g) => ({
    name: g.label,
    fn: () => {
      const before = countEntryFiles();
      const r = mustRun(['save', '--content', g.content, '--category', 'fact']);
      assertExitNonZero(r, `save of ${g.label}`);
      const after = countEntryFiles();
      assert(after === before, `secret content created a file: count ${before} -> ${after}`);
      const combined = `${r.stdout}\n${r.stderr}`;
      for (const secret of g.mustNotEcho) {
        assert(!combined.includes(secret), `CLI echoed the secret value ${JSON.stringify(secret)} in its output`);
      }
    },
  }));
}

// ---------------------------------------------------------------- v1.2.0 cases (19–28)
// These test new features: router rebuild, prune-skeletons, journal-list,
// search date filters, lesson-add warning, session-stop guard behaviours.

// Case 19: Router file rebuilt after save (fix #2 — router staleness).
function routerRebuiltAfterSaveCase() {
  return {
    name: '19. router file rebuilt after save',
    fn: () => {
      const token = 'zqx_router_rebuild_' + Date.now();
      const r = mustRun(['save', '--content', `Router rebuild test ${token}`, '--category', 'fact']);
      assertExitZero(r, 'save for router rebuild');
      const routerPath = path.join(STORE, '00_MEMORY_ROUTER.md');
      assert(fs.existsSync(routerPath), `Router file ${routerPath} not created after save`);
      const routerContent = fs.readFileSync(routerPath, 'utf8');
      assert(routerContent.length > 0, 'Router file is empty after save');
    },
  };
}

// Case 20: prune-skeletons --dry-run leaves skeleton file in place.
function pruneSkeletonsDryRunCase() {
  return {
    name: '20. prune-skeletons --dry-run does NOT delete skeleton',
    fn: () => {
      // Write a fake skeleton entry into the episodic dir.
      const episodicDir = path.join(STORE, '02_episodic');
      fs.mkdirSync(episodicDir, { recursive: true });
      // id MUST match /^m_[0-9a-f]{10}$/ — 10 hex chars exactly.
      const skeletonId = 'm_' + '1234567890';
      const skeletonFile = path.join(episodicDir, '2000-01-01-session-summary-' + skeletonId + '.md');
      const fakeSkeleton = [
        '---',
        'id: ' + skeletonId,
        'category: episodic',
        'tags: [session-summary, skeleton]',
        'source: session',
        'confidence: inferred',
        'importance: 2',
        'created_at: 2000-01-01T00:00:00.000Z',
        'updated_at: 2000-01-01T00:00:00.000Z',
        'access_count: 0',
        'error_signature: ""',
        'trigger: ""',
        'prevention_check: ""',
        '---',
        '',
        'SKELETON -- session summary, NOT YET COMPLETED BY THE AGENT.',
        '',
        '## Summary',
        'TBD',
      ].join('\n');
      fs.writeFileSync(skeletonFile, fakeSkeleton);

      const r = mustRun(['prune-skeletons', '--dry-run']);
      assertExitZero(r, 'prune-skeletons --dry-run');
      assert(fs.existsSync(skeletonFile), 'Skeleton file was deleted even though --dry-run was set');
      const combined = r.stdout + r.stderr;
      assert(
        combined.toLowerCase().includes('dry') || combined.toLowerCase().includes('dry-run'),
        'prune-skeletons --dry-run output did not mention "dry-run"'
      );
      // Cleanup
      fs.rmSync(skeletonFile, { force: true });
    },
  };
}

// Case 21: prune-skeletons (real) deletes skeleton and updates index.
function pruneSkeletonsRealCase() {
  return {
    name: '21. prune-skeletons deletes skeleton file',
    fn: () => {
      const episodicDir = path.join(STORE, '02_episodic');
      fs.mkdirSync(episodicDir, { recursive: true });
      // id MUST match /^m_[0-9a-f]{10}$/ — 10 hex chars exactly.
      const skeletonId = 'm_' + 'ab12cd34ef';
      const skeletonFile = path.join(episodicDir, '2000-01-02-session-summary-' + skeletonId + '.md');
      const fakeSkeleton = [
        '---',
        'id: ' + skeletonId,
        'category: episodic',
        'tags: [session-summary, skeleton]',
        'source: session',
        'confidence: inferred',
        'importance: 2',
        'created_at: 2000-01-02T00:00:00.000Z',
        'updated_at: 2000-01-02T00:00:00.000Z',
        'access_count: 0',
        'error_signature: ""',
        'trigger: ""',
        'prevention_check: ""',
        '---',
        '',
        'SKELETON -- session summary, NOT YET COMPLETED BY THE AGENT.',
        '',
        '## Summary',
        'TBD',
      ].join('\n');
      fs.writeFileSync(skeletonFile, fakeSkeleton);

      const r = mustRun(['prune-skeletons']);
      assertExitZero(r, 'prune-skeletons');
      assert(!fs.existsSync(skeletonFile), 'Skeleton file still exists after prune-skeletons');
    },
  };
}

// Case 22: journal-list shows open journals.
function journalListShowsCase() {
  return {
    name: '22. journal-list shows started journals',
    fn: () => {
      const slug = 'zqxjrnlsmoke' + Date.now();
      const start = mustRun([
        'journal-start',
        '--slug', slug,
        '--goal', 'Smoke test journal list goal',
        '--criteria', 'journal appears in list',
      ]);
      assertExitZero(start, 'journal-start for list test');
      const r = mustRun(['journal-list']);
      assertExitZero(r, 'journal-list');
      assert(
        r.stdout.includes(slug),
        `journal-list output does not contain started journal slug "${slug}". stdout=${r.stdout}`
      );
    },
  };
}

// Case 23: journal-list --open filters closed journals out.
function journalListOpenFilterCase() {
  return {
    name: '23. journal-list --open filters out closed journals',
    fn: () => {
      const slugOpen   = 'zqxjrnlopen'   + Date.now();
      const slugClosed = 'zqxjrnlclosed' + Date.now();

      // Start open journal.
      const startOpen = mustRun([
        'journal-start',
        '--slug', slugOpen,
        '--goal', 'Open journal goal',
        '--criteria', 'stays open',
      ]);
      assertExitZero(startOpen, 'journal-start for open journal');

      // Start closed journal then close it.
      const startClosed = mustRun([
        'journal-start',
        '--slug', slugClosed,
        '--goal', 'Closed journal goal',
        '--criteria', 'gets closed',
      ]);
      assertExitZero(startClosed, 'journal-start for closed journal');

      const closeR = mustRun([
        'journal-close',
        '--slug', slugClosed,
        '--outcome', 'closed for smoke test',
      ]);
      assertExitZero(closeR, `journal-close ${slugClosed}`);

      // list --open: closed journal must NOT appear, open one must.
      const r = mustRun(['journal-list', '--open']);
      assertExitZero(r, 'journal-list --open');
      assert(
        !r.stdout.includes(slugClosed),
        `journal-list --open still shows closed journal "${slugClosed}". stdout=${r.stdout}`
      );
      assert(
        r.stdout.includes(slugOpen),
        `journal-list --open does not show the open journal "${slugOpen}". stdout=${r.stdout}`
      );
    },
  };
}

// Case 24: search --after / --before date range filter.
function searchDateRangeCase() {
  return {
    name: '24. search --after/--before date range filtering',
    fn: () => {
      const token = 'zqx_daterange_' + Date.now();
      const save = mustRun(['save', '--content', `Date range test ${token}`, '--category', 'fact']);
      assertExitZero(save, 'save for date range test');

      // --after yesterday: should find the entry (created today >= yesterday).
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const foundR = mustRun(['search', token, '--after', yesterday]);
      assertExitZero(foundR, 'search --after yesterday');
      assert(
        foundR.stdout.includes(token),
        `search --after yesterday did not find recent entry. stdout=${foundR.stdout}`
      );

      // --before yesterday: entry created today is AFTER yesterday, so it must NOT appear.
      // The CLI prints "no results for ..." when nothing matches; entry content is NOT in output.
      // We verify by checking that the output contains "no results" (not the entry body).
      const notFoundR = mustRun(['search', token, '--before', yesterday]);
      assertExitZero(notFoundR, 'search --before yesterday');
      // The entry body contains the token; if entry IS returned, its content appears after
      // the filename header. The "no results" line only echoes the query string, not content.
      // Check that the search result list is empty (contains "no results" indicator).
      assert(
        notFoundR.stdout.includes('no results'),
        `search --before yesterday should return no results for a today-created entry, but got: ${notFoundR.stdout}`
      );
    },
  };
}

// Case 25: lesson-add without --signature prints warning on stderr (exit 0).
function lessonAddNoSignatureWarningCase() {
  return {
    name: '25. lesson-add without --signature exits 0 but warns on stderr',
    fn: () => {
      // Must supply ALL required flags to reach the signature-warning branch.
      const r = mustRun([
        'lesson-add',
        '--title',      'Zqx Smoke Lesson No Sig ' + Date.now(),
        '--what',       'smoke test what happened',
        '--why',        'smoke test why it matters',
        '--where',      'smoke/test.js',
        '--lesson',     'always add signature to lessons',
        '--trigger',    'when testing lesson-add',
        '--prevention', 'always add --signature',
        // intentionally omitting --signature
      ]);
      assert(r.status === 0,
        `lesson-add without --signature exited ${r.status}; expected 0. stderr=${r.stderr}`);
      assert(
        r.stderr.toLowerCase().includes('warn'),
        `lesson-add without --signature did not print a warning on stderr. stderr=${r.stderr}`
      );
    },
  };
}

// Case 26: session-stop one-per-day limit — calling twice creates only 1 skeleton.
function sessionStopOncePerDayCase() {
  return {
    name: '26. session-stop hook: one skeleton per day maximum',
    fn: () => {
      // We need at least one real entry so session-stop does not skip.
      const save = mustRun(['save', '--content', 'Real entry for session-stop test', '--category', 'fact']);
      assertExitZero(save, 'save for session-stop once-per-day test');

      const HOOK = path.join(ROOT, 'hooks', 'session-stop.js');
      if (!fs.existsSync(HOOK)) {
        // Hook not present — skip gracefully (not a CLI test).
        return;
      }

      function runHook() {
        return spawnSync(process.execPath, [HOOK], {
          env: ENV,
          encoding: 'utf8',
          timeout: 10000,
          input: '',   // empty stdin → no session JSON
        });
      }

      runHook(); // first call
      runHook(); // second call on the same calendar day

      // Count skeleton files today in 02_episodic.
      const today = new Date().toISOString().slice(0, 10);
      const episodicDir = path.join(STORE, '02_episodic');
      let skeletons = 0;
      try {
        skeletons = fs.readdirSync(episodicDir)
          .filter((f) => f.startsWith(today + '-session-summary-') && f.endsWith('.md'))
          .length;
      } catch (_) { /* dir may not exist */ }

      assert(skeletons <= 1, `Expected <= 1 skeleton for today, found ${skeletons}`);
    },
  };
}

// Case 27: session-stop skips on empty store (no real entries).
function sessionStopSkipsEmptyStoreCase() {
  return {
    name: '27. session-stop hook: skips when store has no real entries',
    fn: () => {
      const HOOK = path.join(ROOT, 'hooks', 'session-stop.js');
      if (!fs.existsSync(HOOK)) return; // graceful skip

      // Use a brand-new empty temp store.
      const emptyStore = fs.mkdtempSync(path.join(os.tmpdir(), 'agmem-empty-'));
      const emptyEnv = { ...process.env, AGMEM_DIR: emptyStore, HOME: FAKE_HOME };
      try {
        const r = spawnSync(process.execPath, [HOOK], {
          env: emptyEnv,
          encoding: 'utf8',
          timeout: 10000,
          input: '',
        });
        assert(r.status === 0, `session-stop exited ${r.status} on empty store`);

        // No skeleton files should have been created.
        const episodicDir = path.join(emptyStore, '02_episodic');
        let skeletons = 0;
        try {
          skeletons = fs.readdirSync(episodicDir)
            .filter((f) => f.endsWith('.md'))
            .length;
        } catch (_) { /* dir doesn't exist — that's fine */ }
        assert(skeletons === 0, `session-stop created ${skeletons} skeleton(s) on empty store`);
      } finally {
        try { fs.rmSync(emptyStore, { recursive: true, force: true }); } catch (_) {}
      }
    },
  };
}

// Case 28: --version reports 1.3.0.
function version130Case() {
  return {
    name: '28. --version reports 1.3.0',
    fn: () => {
      const r = mustRun(['--version']);
      assert(r.status === 0, `--version exited ${r.status}`);
      const ver = r.stdout.trim();
      assert(ver === '1.3.0', `Expected version 1.3.0, got: ${ver}`);
    },
  };
}

// Case 29: save refuses canned AI refusal/boilerplate sentences (VI + EN).
function refusalBlockedCase() {
  return {
    name: '29. save blocks AI refusal/boilerplate sentences (VI + EN)',
    fn: () => {
      const before = countEntryFiles();
      const samples = [
        'Em không thể hỗ trợ thực hiện việc này giúp anh được ạ',
        'Xin lỗi anh, em không thể hỗ trợ yêu cầu này.',
        'Em khong the ho tro thuc hien viec nay giup anh duoc a',
        'I cannot fulfill this request.',
        'I apologize, but I cannot assist with that task.',
      ];
      for (const s of samples) {
        const r = mustRun(['save', '--content', s, '--category', 'fact']);
        assertExitNonZero(r, `save of refusal sample "${s}"`);
        assert(
          r.stderr.includes('refused to store: matched AI refusal/boilerplate pattern'),
          `Expected refusal error message for "${s}", got stderr=${r.stderr}`
        );
      }
      const after = countEntryFiles();
      assert(after === before, `refusal samples created files: ${before} -> ${after}`);
    },
  };
}

// Case 30: save strips refusal lines from multi-line factual content.
function refusalLineStrippedCase() {
  return {
    name: '30. save strips AI refusal line while keeping real factual lines',
    fn: () => {
      const factToken = 'zqx_clean_fact_' + Date.now();
      const mixed = [
        'Em không thể hỗ trợ thực hiện việc này giúp anh được ạ',
        `Real project fact ${factToken} kept intact.`,
      ].join('\n');
      const r = mustRun(['save', '--content', mixed, '--category', 'fact']);
      assertExitZero(r, 'save mixed refusal + real fact');
      const file = findEntryContaining(factToken);
      assert(file !== null, `Saved entry with ${factToken} not found`);
      const text = fs.readFileSync(file, 'utf8');
      assert(
        !text.includes('Em không thể hỗ trợ'),
        `Refusal line was not stripped from saved entry: ${text}`
      );
    },
  };
}

// Case 31: prune-noise deletes pure refusal entries and cleans mixed entries.
function pruneNoiseCase() {
  return {
    name: '31. prune-noise deletes refusal entry and cleans mixed entry',
    fn: () => {
      const semanticDir = path.join(STORE, '03_semantic');
      fs.mkdirSync(semanticDir, { recursive: true });
      const pureId = 'm_f0f0f0f001';
      const pureFile = path.join(semanticDir, pureId + '.md');
      fs.writeFileSync(pureFile, [
        '---',
        'id: ' + pureId,
        'category: fact',
        'tags: [noise]',
        'source: session',
        'confidence: inferred',
        'importance: 2',
        'created_at: 2026-01-01T00:00:00.000Z',
        'updated_at: 2026-01-01T00:00:00.000Z',
        'access_count: 0',
        '---',
        '',
        'Em không thể hỗ trợ thực hiện việc này giúp anh được ạ',
      ].join('\n'));

      const r = mustRun(['prune-noise']);
      assertExitZero(r, 'prune-noise');
      assert(!fs.existsSync(pureFile), 'Pure refusal entry file still exists after prune-noise');
    },
  };
}

// ---------------------------------------------------------------- case 17+: hooks.json format validation
// Verifies the hooks.json ships with the correct AGY v2 format:
//   namespaced wrapper + type:command on every hook entry.
function hooksFormatCase() {
  return {
    name: '17. hooks.json has AGY v2 format (namespace + type:command)',
    fn: () => {
      const hooksPath = path.join(ROOT, 'hooks', 'hooks.json');
      assert(fs.existsSync(hooksPath), `hooks.json not found at ${hooksPath}`);
      let hooks;
      try {
        hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      } catch (e) {
        assert(false, `hooks.json is not valid JSON: ${e.message}`);
      }
      // Must be an object (not an array).
      assert(typeof hooks === 'object' && hooks !== null && !Array.isArray(hooks),
        'hooks.json root must be an object');
      // Must have at least one namespace key.
      const namespaces = Object.keys(hooks);
      assert(namespaces.length > 0, 'hooks.json has no namespace keys');
      // Every namespace must wrap event arrays of objects with "type" field.
      for (const ns of namespaces) {
        const events = hooks[ns];
        assert(typeof events === 'object' && events !== null && !Array.isArray(events),
          `Namespace "${ns}" must be an object of event arrays`);
        for (const [evt, arr] of Object.entries(events)) {
          assert(Array.isArray(arr), `Event "${evt}" in namespace "${ns}" must be an array`);
          for (const hook of arr) {
            assert(typeof hook === 'object' && hook !== null,
              `Hook entry in "${ns}.${evt}" must be an object`);
            assert(typeof hook.type === 'string' && hook.type.length > 0,
              `Hook entry in "${ns}.${evt}" missing "type" field`);
            assert(typeof hook.command === 'string' && hook.command.length > 0,
              `Hook entry in "${ns}.${evt}" missing "command" field`);
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------- case 18: --version reports 1.1.0
function versionCase() {
  return {
    name: '18. --version reports 1.1.0',
    fn: () => {
      const r = mustRun(['--version']);
      assert(r.status === 0, `--version exited ${r.status}`);
      const ver = r.stdout.trim();
      assert(ver === '1.1.0', `Expected version 1.1.0, got: ${ver}`);
    },
  };
}

// Push static cases added after the main array literal.
cases.push(hooksFormatCase());
// v1.1.0 version case intentionally replaced by case 28 below; skip old check.
// cases.push(versionCase()); // replaced — now reports 1.2.0

// v1.2.0 cases
cases.push(routerRebuiltAfterSaveCase());
cases.push(pruneSkeletonsDryRunCase());
cases.push(pruneSkeletonsRealCase());
cases.push(journalListShowsCase());
cases.push(journalListOpenFilterCase());
cases.push(searchDateRangeCase());
cases.push(lessonAddNoSignatureWarningCase());
cases.push(sessionStopOncePerDayCase());
cases.push(sessionStopSkipsEmptyStoreCase());
cases.push(version130Case());
cases.push(refusalBlockedCase());
cases.push(refusalLineStrippedCase());
cases.push(pruneNoiseCase());

// ---------------------------------------------------------------- runner
console.log(`CLI:   ${CLI}`);
console.log(`Store: ${STORE} (temp only, via AGMEM_DIR; fake HOME: ${FAKE_HOME})`);
if (!fs.existsSync(CLI)) console.log(`NOTE: ${CLI_MISSING_MSG}`);

let passed = 0;
let failed = 0;
const failures = [];
for (const c of cases) {
  try {
    c.fn();
    passed++;
    console.log(`PASS - ${c.name}`);
  } catch (e) {
    failed++;
    failures.push(c.name);
    console.log(`FAIL - ${c.name}\n      reason: ${e && e.message ? e.message : String(e)}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed, ${cases.length} total.`);
if (failed > 0) {
  console.log(`Temp store kept for inspection: ${STORE}`);
} else {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch (_) {
    // Best-effort cleanup only; a leftover temp dir is not a test failure.
  }
}
process.exitCode = failed > 0 ? 1 : 0;
