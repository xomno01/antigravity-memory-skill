---
id: m_7c6d5e4f3a
category: lesson
tags: [example-api, testing, refactor]
source: tool-output
confidence: verified
importance: 4
created_at: 2026-10-26T11:00:00Z
updated_at: 2026-10-26T11:00:00Z
access_count: 0
error_signature: "test failed, assertionerror, expected"
trigger: "tests fail right after a refactor"
prevention_check: "Run `npm test` before reporting done, and re-run after any fix"
---

Title: Tests failed after a refactor because a stale mock leaked between cases
What: After moving the validation helper, three unit tests failed with AssertionError on expected output.
Why: A shared mock from an earlier test case was not reset, so later cases saw stale input.
Where: `test/validation.test.js`, run with `npm test`
Lesson: Reset shared mocks in each test's setup step, and treat a test failure as a signal to record a lesson before retrying.
Trigger: tests fail right after a refactor
Prevention: Run `npm test` before reporting done, and re-run after any fix
