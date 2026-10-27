---
name: antigravity-memory
description: Use when working on long-running work in Antigravity that must be remembered across sessions — decisions, mistakes, lessons, user preferences, and project facts. Run the memory context at session start, save important decisions and corrections, record a lesson whenever something fails or the user corrects you, keep a thinking journal for multi-step tasks, and verify against acceptance criteria before reporting done.
---

# antigravity-memory

A local, file-based memory skill for Google Antigravity. It remembers decisions,
mistakes, lessons, preferences, and project facts across sessions by storing
them as Markdown entries in a local store and re-reading them at session start.
It uses only the local filesystem and the bundled Node.js CLI. It makes no
network calls and sends nothing anywhere.

## Honesty — read this first

- This skill does **NOT** guarantee that any user request comes out exactly as
  the user intended. No memory system can promise that. It only maximizes
  intent-match through: (a) acceptance criteria extracted at session start,
  (b) a clarification loop when a request is ambiguous, irreversible, or
  costly, (c) a verification gate before reporting done (run the project's
  real checks and compare the result against the criteria), and (d) a lesson
  recorded whenever output misses intent.
- This skill **CANNOT** read a model's hidden chain-of-thought. The substitute
  is the thinking journal (below): for tasks of more than ~3 steps, write your
  reasoning to a file **before** acting — goal, criteria, hypotheses, options
  considered and rejected with reasons, assumptions, and verification plan —
  and update it after finishing. The journal is what gets re-read and audited.
  Never claim otherwise.

## When to use this skill

Use it when any of these is true:

- The work spans more than one session, or the user may return to it later.
- A decision, convention, preference, or project fact should survive a new
  conversation (a new thread does not inherit another thread's history).
- You are about to answer a question about past work, a past decision, or
  why something was done a certain way.
- The task has more than ~3 steps, is irreversible, or is costly to redo.

Do not use the memory store for secrets, credentials, tokens, or private keys.
Saving is refused when content matches a secret pattern (see "Never store
secrets" below), and the refusal names only the pattern class, never the value.

## Session start

At the start of every session where this skill applies, run the memory
context and read the router before doing other work:

```sh
node <skill-dir>/scripts/memory.js context
```

- `context` prints the memory router plus the top entries by category
  priority: user, preference, project, decision, lesson, fact, episodic, other.
- Read the full entry file for anything the router line alone does not settle.
  The router is a summary (at most 40 lines); it points at entries, it does
  not replace them.
- The same applies to `search` and `context` snippets: they are previews,
  not full entries (lesson hits show Lesson + Prevention, other hits show
  the first line only). Before acting on a snippet — especially a lesson —
  run `get <id>` for the full entry whenever the snippet does not settle it.
- If the user asks about past work, also run `search` before answering (see
  "CLI reference"). Do not answer from vague recollection when a stored entry
  exists; quote or paraphrase the entry, and say when no entry was found.

Store resolution, in order: `--dir` flag, then the `AGMEM_DIR` environment
variable, then `<cwd>/.agents/memory` if a `.agents/` directory exists in the
working directory, then `$HOME/.antigravity-memory`. For a project install,
set `AGMEM_DIR` to the project `.agents/memory` directory, or pass `--dir`
explicitly. Hooks pass `--dir` the same way.

## When to save

Save an entry promptly — do not batch saves until the end of the session —
after any of these:

- An important decision is made (what was chosen, why, and what was rejected).
- The user states a preference, a fact about themselves, or a project
  convention.
- A durable project fact is established (architecture, tooling, constraints).
- An error occurs, a test/lint/build fails, output is wrong, or the user
  corrects you (see "Lessons" — a lesson comes first in those cases).
- A task finishes with an outcome worth reusing (see "Thinking journal").

Keep each entry body to one self-contained fact, at most ~2000 characters;
split longer facts. Saving a duplicate (same normalized body) must not create
a second file: update tags, source, and `updated_at` instead.

## Lessons

A lesson is a stored entry of category `lesson` in `04_procedural-lessons/`,
with these mandatory body sections: `Title`, `What` (symptom / what went
wrong), `Why` (root cause, evidence-backed, one sentence), `Where` (file /
command / tool), `Lesson` (what to do differently), `Trigger` (the situation
pattern that should recall this lesson), and `Prevention` (the exact check or
command to run before similar work).

Record a lesson **before** retrying where possible, and always before
reporting done after a failure, when any of these happens:

- A test, lint, or build fails.
- A tool errors.
- Output is wrong.
- The user corrects you.

Before similar work in a later session, run `lesson-check` against the
error or situation text and follow any matching lesson's prevention check
first. A lesson's `error_signature` is a comma-separated list of trigger
substrings (lowercase); `lesson-check` matches them case-insensitively.

## Thinking journal

For any task of more than ~3 steps, keep a thinking journal in
`05_thinking-journal/` (file `<YYYY-MM-DD>-<slug>.md`):

1. `journal-start` **before** acting, with goal, acceptance criteria, and
   options considered. Mandatory sections: `Goal`, `Acceptance criteria`,
   `Hypotheses`, `Options considered (and rejected, with reason)`,
   `Assumptions`, `Verification plan`, `Progress notes`, `Outcome`,
   `Lesson link`.
2. `journal-note` after each major step.
3. `journal-close` at the end, with the outcome and a link to any lesson
   created along the way.

This journal is the auditable record of your reasoning. It is not a claim
about hidden model internals; it is the reasoning you chose to write down.

## Verification gate — before reporting done

Never report a task done on the basis of having produced output. Before
reporting done:

1. State the acceptance criteria (from the journal, or extracted at session
   start if the task was small).
2. Run the project's real checks (tests, lint, build, or the manual check
   the project actually uses) — do not simulate them.
3. Compare the check results against the criteria, item by item.
4. If anything fails or is unchecked, say so plainly, record a lesson if a
   failure occurred, and do not claim completion.

If the request was ambiguous, irreversible, or costly, clarify with the user
before acting rather than after.

## CLI reference

The single entry point is `scripts/memory.js` (Node.js >= 18, standard
library only). All subcommands print plain text to stdout, errors to stderr,
and exit non-zero on failure. Run it as:

```sh
node <skill-dir>/scripts/memory.js <command> [args] [--dir <path>]
```

- `context [--max-items N]` — print the router plus top entries by category
  priority. Default max 30 items.
- `search <query> [--limit N] [--category C] [--after DATE] [--before DATE]` — ranked entries with scores.
  Default limit 8. `--after`/`--before` accept `YYYY-MM-DD` or ISO 8601 (inclusive endpoints).
- `save --content "..." [--category C] [--tags a,b] [--source S]
  [--confidence C] [--importance N]` — save one entry. Categories: `user`,
  `preference`, `project`, `decision`, `lesson`, `fact`, `episodic`, `other`.
  Confidence: `verified`, `user_stated`, `inferred`. Importance: 1–5
  (5 = user-asserted or load-bearing, 1 = trivial).
- `get <id>` — print one entry. `list [--category C] [--limit N]` — list
  entries. `update <id> [--content ...] [--tags ...]` — update an entry.
  `delete <id>` — delete an entry.
- `lesson-add --title ... --what ... --why ... --where ... --lesson ...
  --trigger ... --prevention ... [--signature "sub1,sub2"]` — record a lesson.
  Omitting `--signature` exits 0 but prints a warning on stderr; lessons
  without signatures cannot be found by `lesson-check`.
- `lesson-check <error-or-situation-text>` — list lessons whose signature
  substrings appear in the text.
- `journal-start --slug ... --goal ... --criteria ...` — start a journal.
- `journal-note --slug ... --note ...` — append a progress note.
- `journal-close --slug ... --outcome ... [--lesson <lesson-id>]` — close a
  journal, optionally linked to a lesson.
- `journal-list [--open]` — list all journals; `--open` filters to unclosed ones only.
- `prune-skeletons [--dry-run]` — delete unfilled session-stop skeleton entries.
  `--dry-run` previews deletions without making changes.
- `prune-noise [--dry-run]` — delete entries consisting solely of canned AI
  refusal/apology boilerplate (e.g. "Em không thể hỗ trợ thực hiện việc này
  giúp anh được ạ", "I cannot fulfill this request") and strip refusal lines
  from multi-line entries.
- `index` — rebuild `index.json` and regenerate the router (the router is
  capped at 40 lines; truncation must enforce that cap).
- `--path` — print the resolved store path.
- `--export` — print the whole store as JSON.
- `--version` — print version `1.3.0`.

Writes are atomic (temporary file + rename). A corrupt entry file is skipped
with a stderr warning and never crashes the whole command.

## Storage layout

```
<store>/
  00_MEMORY_ROUTER.md            # GENERATED by `memory.js index`. Never hand-edit.
  01_user-profile/*.md           # user facts, preferences
  02_episodic/*.md               # session summaries, decisions, work logs
  03_semantic/*.md               # durable knowledge, project facts, conventions
  04_procedural-lessons/*.md     # lessons from mistakes
  05_thinking-journal/*.md       # thinking journals
  index.json                     # search index, rebuilt automatically when stale
```

Each entry is one Markdown file with YAML frontmatter: `id`
(`m_` + 10 lowercase hex characters), `category`, `tags`, `source`
(`user`, `tool-output`, `file-path`, `url`, or `session`), `confidence`,
`importance` (1–5), `created_at` / `updated_at` (ISO 8601), `access_count`,
and lesson-only fields `error_signature`, `trigger`, `prevention_check`.

The router (`00_MEMORY_ROUTER.md`) is generated, at most 40 lines, with
sections in this order: `# Memory Router`, `## User`, `## Active projects`,
`## Key decisions`, `## Lessons — triggers` (one line each:
`trigger → file`), `## Open threads`. Entries are truncated by importance,
then recency.

## Token budget and forgetting policy

- Router: at most 40 lines (hard cap enforced by `index`).
- `context` default: 30 items. `search` default: 8 results.
- The always-on rule file is kept under 2 KB, so the aggregate budget for
  always-on rules stays healthy.
- Forgetting is never automatic deletion. `index` flags stale candidates for
  user review: entries with importance ≤ 2 and no access in 180 days. Never
  flag or delete entries with confidence `user_stated` and importance ≥ 4
  without explicit user confirmation.

## Slash command procedures

Antigravity slash commands below are **procedures in this skill that call
the CLI** — they are not separate command files, and this skill does not
invent a command-file format for them:

- `/remember` — save the session's key facts (`save`, one entry per fact)
  and close any open thinking journal (`journal-close`, with outcome and
  lesson link). Use at session end or when the user says "remember this".
- `/recall` — run `context`, then `search` for the topic, then read the
  full entry files the results point at before answering.
- `/lesson` — run `lesson-add` with all mandatory lesson fields, before
  retrying or reporting done after a failure.

Complementary built-in Antigravity commands (not replacements for this
skill): `/learn` proposes session corrections as reviewable rule/skill
changes, and `/resume` continues a previous conversation thread. A resumed
thread keeps its history; a new thread does not inherit it except through
this store.

## Never store secrets or AI refusal boilerplate

On every `save`, `update`, `lesson-add`, `journal-note`, and `journal-close`:
- **Secret guard:** Content matching a secret pattern is refused and never stored:
  long digit runs (14–19 digits, allowing spaces/dashes), Google API keys
  (`AIza` + 30+ characters), token formats (`sk-`, `pk-`, `ghp_`, `gho_`,
  `xoxa/b/p-` + 16+ token characters), PEM private key headers, and password
  assignments. On a match the CLI refuses to store, prints an error naming only
  the pattern class (never the secret itself), and exits non-zero.
- **Refusal / boilerplate guard:** Canned AI refusal or apology lines (e.g.
  *"Em không thể hỗ trợ thực hiện việc này giúp anh được ạ"*, *"Xin lỗi, em
  không thể hỗ trợ..."*, *"I cannot fulfill this request"*, *"As an AI, I
  cannot..."*) are automatically stripped from multi-line saves, and any save
  consisting solely of a refusal sentence is rejected outright. Use
  `prune-noise` to clean any historical noise from an existing store.
