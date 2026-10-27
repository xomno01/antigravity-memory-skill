---
trigger: always_on
description: Always-on memory discipline for Antigravity — load memory at session start, save decisions and lessons, journal multi-step work, verify before reporting done.
---

# Memory — always on

- At session start, run `node <skill-dir>/scripts/memory.js context` and read the router before other work.
- Before answering about past work, run `memory.js search` and read the full entry; never answer from vague recollection when an entry exists.
- After an important decision, an error, or a user correction, save it at once; after a failure, record a lesson (`lesson-add`) before retrying or reporting done.
- For tasks over ~3 steps, start a thinking journal (`journal-start`) before acting, note each major step, and close it (`journal-close`) at the end.
- Before reporting done, run the project's real checks and compare results against the acceptance criteria; report failures plainly.
- Never store secrets, credentials, or private keys in memory entries.
