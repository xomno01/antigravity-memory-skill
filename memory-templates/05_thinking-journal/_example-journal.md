---
id: m_1a2b3c4d5e
category: other
tags: [example-api, refactor, journal]
source: session
confidence: inferred
importance: 3
created_at: 2026-10-26T10:00:00Z
updated_at: 2026-10-26T12:00:00Z
access_count: 0
---

## Goal
Refactor the request-validation helper in example-api into a standalone module without adding dependencies.

## Acceptance criteria
- `npm test` passes with no new dependencies in package.json.
- Empty and malformed input are covered by tests.

## Hypotheses
- The helper's only shared state is its input parser, so extraction should not change behaviour.
- Existing tests already cover the main valid-input paths.

## Options considered (and rejected, with reason)
- Adopt a validation library (rejected: breaks the project's zero-dependency rule).
- Rewrite the helper from scratch (rejected: higher risk than moving tested code as-is).

## Assumptions
- The repo's test command is `npm test` and its suite is the project's real check.
- No other module imports the helper's internal functions, only its public entry point.

## Verification plan
- Run `npm test` before and after the move; compare results.
- Check `package.json` to confirm no dependency was added.

## Progress notes
- 2026-10-26: extracted the helper; two tests failed on stale mock state, lesson recorded before retry.
- 2026-10-26: reset mocks in test setup; full suite passes.

## Outcome
Refactor complete: standalone module, no new dependencies, full suite green.

## Lesson link
04_procedural-lessons/_example-lesson.md (stale mock leaking between test cases)
