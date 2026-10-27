# System Model — Antigravity Memory Skill

**Audience:** agents and developers working on this skill.
**Status:** a qualitative / estimation model of how this skill's memory system
behaves. It is not a law of physics, and it reports no measured experimental
results. Every mechanism named here is one defined in the coordinator spec
(`antigravity-memory-skill-work/spec.md`); where this document reasons beyond
the spec, it says so explicitly.

**Scope note.** This document models the system; it does not change any
interface. The router, the five storage tiers, the retrieval formula, the
lesson protocol, the thinking journal, the verification gate, and the token
budget below are all exactly as specified. If this model and the spec ever
disagree, the spec wins.

## 0. The system in one paragraph

The skill stores memory as Markdown files in five tiers under one store root:

- `01_user-profile/` — user facts and preferences;
- `02_episodic/` — session summaries, decisions, work logs;
- `03_semantic/` — durable knowledge, project facts, conventions;
- `04_procedural-lessons/` — lessons from mistakes;
- `05_thinking-journal/` — thinking journals.

Above them sits a generated pointer layer, `00_MEMORY_ROUTER.md`, capped at
40 lines, plus a derived `index.json` that is rebuilt from the files whenever
any file is newer than the index. Nothing is loaded wholesale. A session
starts from the router, pulls full entry files on demand (progressive
disclosure), searches with a scored ranking, checks lessons before risky
work, and verifies output against acceptance criteria before reporting done.
That shape — a small fixed pointer layer plus on-demand retrieval plus a
correction loop — is what the rest of this document models.

The retrieval score, from spec §5, is worth writing down once because
several sections below refer to its terms:

> Final score = BM25-lite × tier weight × importance factor
> + recency bonus + exact-phrase bonus

where BM25-lite uses k1 = 1.2, b = 0.75, and
idf = ln(1 + (N − df + 0.5) / (df + 0.5)); tier weights are lesson 1.6,
user 1.5, preference 1.4, decision 1.2, project 1.1, fact 1.0, episodic 0.9,
other 0.8; the importance factor is (0.7 + 0.3 × importance / 5) for
importance 1–5; the recency bonus is 0.5 × 2^(−age in days / 60), a 60-day
half-life; and the exact-phrase bonus is +2.0 when the normalized query
string appears in the normalized content. Search returns the top N entries
(default 8); the context view returns the router plus top entries by category
priority (user, preference, project, decision, lesson, fact, episodic, other),
with a default cap of 30 items. Lesson checking is a separate, non-BM25
mechanism: it returns lessons whose `error_signature` substrings appear
(case-insensitively) in the supplied error or situation text, ranked by
number of matched substrings, then by importance.

## 1. Signal-to-noise ratio (SNR) of a memory entry

### 1.1 What counts as signal, what counts as noise

**Signal** is an entry that changes a later decision for the better. In this
system's terms, that means one of two things:

- a fact, preference, decision, or project convention that lets the agent
  choose correctly without re-asking the user or re-deriving something
  already settled (for example, a user-stated preference that constrains a
  choice, or a decision record that explains why an approach was rejected);
- a lesson that prevents a repeated error — the entry's value is measured
  not by how interesting it reads, but by an error that does *not* happen
  again because its prevention check was run first.

**Noise** is an entry that consumes budget, ranking slots, or attention
without changing any decision for the better. Three kinds dominate in
practice:

- *stale* entries: once true, now superseded, but still ranked and still read;
- *duplicated* entries: the same fact stored twice, so it occupies two
  ranking slots and can drift into two inconsistent versions;
- *weakly inferred* entries: plausible guesses recorded with the same
  authority as observed facts, which then steer decisions they should only
  have suggested.

SNR, for this document, is the ratio of decision-changing entries retrieved
to entries retrieved that change nothing or mislead. It is a property of a
retrieval *result set* (what a query actually returns), not a property of
the store as a whole: a store can hold mostly signal and still return noise
if ranking is wrong, and vice versa. That is why the mechanisms below act
at three different points — at write time, at ranking time, and at
load time — rather than in one place.

### 1.2 Mechanisms that raise SNR

**Deduplication at write time.** A save whose normalized body duplicates an
existing entry must not create a second file; instead it updates tags,
source, and `updated_at` on the existing entry. This removes the duplicated
class of noise at its source and, as a side effect, keeps the document count
N in the BM25 idf term honest: N counts distinct entries, not copies.

**Importance (1–5) as a prior on value.** Importance 5 is reserved for
user-asserted or load-bearing entries; 1 is trivial. It enters the score
multiplicatively through the importance factor (0.7 + 0.3 × importance / 5),
so the full swing from importance 1 to 5 is a factor of 0.76 to 1.0 — a
deliberate, modest tilt, not a veto. The modesty matters: it lets a
high-importance entry outrank a slightly better lexical match, but it does
not let a stale importance-5 entry outrank everything forever. Importance
is a human-set prior, and like any prior it can be wrong; §4 discusses what
happens then.

**Confidence levels as provenance, not just a label.** Each entry carries
`verified`, `user_stated`, or `inferred`. Confidence does not enter the
BM25 score formula directly, but it governs how entries may be treated
downstream, which is where it protects SNR: a `user_stated` entry with
importance ≥ 4 can never be flagged or deleted without explicit user
confirmation, so the highest-authority signal cannot be silently pruned as
"stale"; conversely, an `inferred` entry is visibly marked as the weakest
kind of evidence, so an agent reading it can discount it rather than act on
it as fact. The practical rule for agents is: treat `inferred` as a
hypothesis to verify, `user_stated` as a constraint, and `verified` as a
checked result.

**Tier weights as a statement about which knowledge prevents errors.**
Lessons weigh 1.6, above user facts at 1.5 and preferences at 1.4, down to
episodic records at 0.9. The ordering encodes a judgement: when a query
matches both a lesson and an ordinary fact, the lesson is more likely to be
the decision-changing item, because it exists precisely where something
already went wrong once. Episodic records weigh lowest because a session
log is usually background, not the deciding fact. Tier weights are the
system's cheapest form of supervision: they require no training, but they
also cannot adapt — if a project's episodic logs turn out to be its most
valuable tier, the weights will systematically under-rank them until a
human revises the spec.

**Exact-phrase bonus (+2.0) as a precision rescue.** BM25-lite is a bag of
tokens with prefix matching; it can dilute a query whose decisive feature
is a specific phrase (an error string, a command name, a distinctive term).
The +2.0 bonus is additive and large relative to the recency bonus (which
maxes out at 0.5), so an entry containing the exact query phrase jumps the
ranking even if its token statistics are mediocre. This is the mechanism
most likely to surface the one load-bearing entry that a pure lexical
ranking would bury — and, symmetrically, the mechanism most sensitive to a
misleading phrase match, since a phrase can match for the wrong reason.

**Recency bonus with a 60-day half-life.** The bonus starts at 0.5 for a
brand-new entry and halves every 60 days. It is additive, not
multiplicative, so it breaks ties toward fresh entries without overriding
strong lexical or tier evidence. Its role in SNR is narrow but real: it
suppresses the specific noise class of "old entries that match weakly but
are no longer the current convention," while leaving strong old entries
intact.

### 1.3 Mechanisms that reduce noise

**Router truncation by importance, then recency.** The router is capped at
40 lines, and truncation keeps the highest-importance, then most recent,
lines. This is a load-time noise filter: the always-loaded set is biased
toward entries most likely to be signal, and everything else must earn its
way in through an explicit search. The cost is a coverage risk (see §5,
router coverage): a genuinely important but low-importance-scored entry can
fall out of the router and be found only if the agent searches for it.

**Top-N caps on retrieval.** Search defaults to 8 results; context defaults
to 30 items. A cap is a noise control as much as a token control: beyond
the top few results, BM25-lite scores flatten and the marginal entry is
more likely to be a weak match than a missed gem. The cap forces the
system to be judged on its best candidates rather than flooding the agent
with its mediocre ones.

**Stale-candidate listing, without auto-deletion.** The index command
lists, for user review, entries with importance ≤ 2 and no access in 180
days. This is deliberately a *listing*, never an automatic delete, and it
never targets `user_stated` entries with importance ≥ 4 without explicit
user confirmation. The design trades recall for safety: some noise survives
longer than it should, but no signal is destroyed by an automated judgement
about staleness. SNR improves only when a human acts on the listing — the
mechanism produces the candidate set; the user supplies the judgement.

**Body size cap.** Ordinary entry bodies are capped at 2000 characters
(longer facts are split). This bounds the noise contribution of any single
entry: no one verbose entry can dominate a context window, and splitting
forces long facts to become several retrievable units, each of which can be
ranked, updated, or pruned independently.

## 2. Information density: why a 40-line router plus progressive disclosure compresses well

### 2.1 The router is an index, not a summary

Progressive disclosure works because the router stores *pointers with just
enough content to choose among them*, not the content itself. Each router
line names a fact, a decision, or a lesson trigger and points at the file
that holds the full entry. The agent pays the full cost of an entry only
after deciding, from the pointer, that the entry is probably relevant. This
is the same reason a book's table of contents is shorter than the book: the
index is useful precisely because it discards everything except the
information needed to *locate* information.

Two consequences follow. First, the router's cost is bounded by a constant
(40 lines) no matter how large the store grows, while its usefulness grows
with the store, because more entries mean more pointers to choose from —
up to the point where truncation starts discarding pointers the agent
would have wanted (the coverage limit in §5). Second, the cost of a wrong
pointer choice is small: reading a full entry file that turns out to be
irrelevant costs one file, not the whole store. The system therefore
tolerates imperfect ranking in a way that whole-history loading cannot:
with whole-history loading, every irrelevant passage is paid for in every
session; with progressive disclosure, an irrelevant passage is paid for
only in the sessions where it is actually opened.

### 2.2 A quantitative sketch (estimation model, not measurement)

No experimental token counts exist for this skill, and none are claimed
here. The comparison below is an order-of-magnitude estimation model built
from the spec's own caps, with its assumptions stated so a reader can
substitute their own numbers.

*Assumptions (illustrative, not measured).* A router line averages roughly
15 words, or about 20 tokens, so a full 40-line router costs on the order
of 800 tokens. An ordinary entry body is capped at 2000 characters, roughly
400–500 tokens at the upper end; a typical short entry is well below that.
A search returns at most 8 entries by default; a context view at most 30
items including the router.

*Whole-history loading.* Suppose a project's chat history grows to H tokens
across sessions. Loading it costs H tokens in *every* session, and H grows
without bound as sessions accumulate: cost per session is O(H), and total
cost across S sessions is O(S × H). Worse, most of H is irrelevant to any
given decision — greetings, dead ends, superseded plans — so the
signal-to-noise ratio of the loaded material falls as H grows, while its
price rises. There is no cap, no ranking, and no way to pay only for the
relevant part.

*Router plus on-demand loading.* A session pays a fixed ~800 tokens for
the router, plus k entries actually retrieved, where k ≤ 8 for a search or
≤ 30 for a context view, and each entry costs at most ~500 tokens at the
cap. A session that needs one search therefore costs on the order of
800 + 8 × 500 ≈ 4,800 tokens at the absolute worst case, and far less in
the typical case of short entries — and, crucially, this cost does not
grow with the total size of the store. Even a store of thousands of
entries costs the same per session as a store of fifty, as long as ranking
finds the right entries. Total cost across S sessions is O(S × (router +
k × entry)), with no H term at all.

*Reading the comparison honestly.* The saving is not free. It is bought
with two risks that whole-history loading does not have: (a) a retrieval
miss — the needed entry exists but is neither in the router nor in the
top-k results, so the agent proceeds without it, or pays for extra search
rounds to find it; and (b) a ranking distortion — the score is a lexical
proxy, so the top-k set can be systematically wrong in ways that whole
history, for all its waste, is not. The compression is therefore best
understood as *lossy compression with a cheap recovery path*: the router
pointer plus a search round usually recovers a missed entry at the cost of
one more retrieval, whereas whole-history loading avoids misses by paying
the maximum price every time. For a system used across many sessions, the
expected total favours progressive disclosure as soon as the store is
large enough that H exceeds a few thousand tokens — which is to say, after
roughly the first substantive session.

*Why the < 40-line cap, specifically, is the right shape of bound.* A line
cap rather than a token cap keeps the router human-readable and
regenerable by a simple rule (truncate by importance, then recency), and
40 lines is small enough to fit comfortably alongside the always-on rule
file (kept under 2 KB against a 20,000-token aggregate budget for
always-on plus global rules) without crowding out working context. The
exact number 40 is a policy choice, not a derived optimum; the structural
point is that the cap is *constant*, so router cost cannot drift upward
with store size.

## 3. Optimisation under constraint: remembering as much as possible inside a token budget

### 3.1 The problem, stated as a knapsack

Each session has a token budget B for memory (part of the model's context
window, shared with the task itself). Each candidate entry i has a token
cost c(i) — roughly its body length — and a value v(i) — how much it
improves the session's decisions. The ideal is:

> maximise the sum of v(i) over loaded entries, subject to the sum of
> c(i) ≤ B.

This is a knapsack problem: items with values and weights, one capacity
constraint. Knapsack is NP-hard in general, which means no algorithm can
guarantee the optimal set for arbitrary entries at reasonable cost. The
skill therefore does not attempt exact optimisation. It uses the standard
practical approximation: **greedy by value density** — rank candidates by
v(i) / c(i), take them in that order until the budget is full.

In this skill, v(i) is approximated by the retrieval score of §0 (BM25-lite
× tier weight × importance factor + recency + phrase bonus), and c(i) is
bounded by the 2000-character body cap, which keeps the density ratio from
degenerating: no entry can be so long that its density collapses purely on
length, and no entry can be so short that trivial one-line facts dominate
purely on cheapness. The search default (top 8) and context default (top 30)
act as additional, cruder budget caps that do not even need token counting:
they bound the number of items, which bounds cost whenever entry lengths
are themselves bounded.

### 3.2 Why greedy by score-per-token is the pragmatic choice

- *It reuses work already done.* The retrieval score is computed anyway for
  ranking; dividing by a length estimate is nearly free, whereas solving
  knapsack exactly would require a separate optimisation pass over every
  candidate on every query.
- *It is incremental and interruptible.* Greedy selection can stop at any
  budget — 8 items, 30 items, or a token threshold — and the partial result
  is still sensible, because items are taken in density order. An exact
  solver's intermediate state is not useful in the same way.
- *It degrades gracefully.* If the budget shrinks (a longer task, a smaller
  window), greedy simply takes fewer items, still in the best density order.
  If the budget grows, it takes more. The policy does not need to change
  with B.
- *It matches how the rest of the system already truncates.* The router
  truncates by importance then recency; search truncates by score; density
  greedy is the same family of rule — a single ordering, cut at a budget —
  applied with a cost-aware ordering. Consistency of mechanism is itself a
  virtue in a system maintained by humans: one truncation idea to understand,
  not three unrelated ones.

For the common case — many roughly independent facts, each moderately
valuable, each modestly sized — greedy by density is also provably close to
optimal (within a bounded factor for the fractional relaxation, and
typically near-optimal in practice for the integral version when no single
item dominates the budget). The skill's body cap helps keep it in that
common case by preventing any single entry from dominating B.

### 3.3 When greedy by density fails

**The long load-bearing entry.** Consider a prevention checklist, a
user-stated constraint with detailed exceptions, or a journal outcome that
explains why an approach failed. It may be 2000 characters (high c(i)),
with a moderate retrieval score (v(i)) because its vocabulary only
partially overlaps the query. Its density v(i)/c(i) is therefore low, and
greedy passes over it in favour of several short, high-density trivia
entries whose combined value is real but smaller than the one decision the
long entry would have changed. The failure is structural: density greedy
assumes values add up independently, but a load-bearing entry's value is
often *thresholded* — it is worth everything if present (the decision
flips) and nothing if absent, and no number of short entries substitutes
for it.

**Complementary entries.** Two entries can be worth more together than
apart (a fact plus the lesson that constrains how to apply it; a decision
plus its rejected alternative). Greedy evaluates each entry alone and can
take the first while dropping the second for a marginally denser unrelated
entry, breaking the pair. The score formula has no interaction term, so
complementarity is invisible to it.

**Score error concentrated at the top.** Greedy trusts the score ordering
completely. If the score is wrong — a weakly inferred entry that happens
to match the query's tokens well, or a lesson whose trigger phrase matches
for the wrong reason — greedy loads the wrong entries first and, under a
tight budget, may never reach the right ones. Whole-history loading is
immune to this failure mode precisely because it does not rank at all;
density greedy buys efficiency by accepting ranking risk.

**Mitigations already in this skill, and their limits.** Four features
soften, but do not eliminate, these failures. First, tier weights and the
importance factor inflate v(i) for lessons and user-stated entries, partly
offsetting a long entry's density penalty. Second, the exact-phrase bonus
(+2.0) can rescue a long entry when the query contains its distinctive
phrase. Third, router truncation uses importance-then-recency rather than
density, so the always-loaded set is not density-filtered at all — a long
importance-5 entry survives in the router where density greedy would drop
it. Fourth, progressive disclosure provides an escape hatch: the agent can
fetch any single entry file by id after seeing its router pointer, outside
the ranked budget entirely. None of these fixes complementarity, and none
guarantees the load-bearing entry is found; they lower the failure rate
and give the agent a manual recovery path, which is the honest level of
assurance this design offers.

## 4. The correction loop as a control system

### 4.1 The loop, component by component

The lesson mechanism is a feedback control loop with four stages:

1. **Sensor — the error, and the lesson written from it.** When a
   test, lint, or build fails, a tool errors, output is wrong, or the user
   corrects the agent, the agent must write a lesson *before retrying
   where possible, and always before reporting done after a failure*.
   The lesson file records Title, What (symptom), Why (root cause, stated
   as evidence-backed in one sentence), Where (file / command / tool),
   Lesson (what to do differently), Trigger (the situation pattern that
   should recall it), and Prevention (the exact check or command to run
   before similar work). The sensor's output is therefore not a raw error
   signal but a *digested* one: symptom plus attributed cause plus
   prescribed check.
2. **Controller — trigger matching and the prevention check.** On later
   work, the lesson-check mechanism matches the current error or situation
   text against stored `error_signature` substrings (case-insensitive),
   ranks matches by number of matched substrings then importance, and
   surfaces the applicable lessons. The agent then runs the lesson's
   prevention check *before* the similar work — the control action. Note
   the controller has two distinct gains: a *matching* gain (how broad the
   signature substrings are) and an *action* gain (how much the prevention
   check constrains the next attempt, from a quick checklist item to a
   mandatory command).
3. **Plant — the next attempt.** The agent performs the similar task with
   the prevention check applied. This is the system being controlled: its
   behaviour changes only through the controller's action, and its output
   is the next result, correct or not.
4. **Feedback — measuring whether repeats fall.** If the same error
   recurs, the sensor fires again: either the lesson was not triggered
   (a matching failure), was triggered but its prevention check was
   insufficient (a control-action failure), or was triggered and followed
   but the root cause was misdiagnosed (a sensor failure). Each recurrence
   is therefore diagnostic about *which* stage failed, not just evidence
   that "the system didn't work." The verification gate closes the loop
   at session level: before reporting done, the agent runs the project's
   real checks and compares output against the acceptance criteria
   extracted at session start, and any miss becomes a new lesson.

The loop's timescale matters. It does not operate within a single action;
it operates across tasks: today's error changes tomorrow's attempt. That
delay is inherent — a lesson can only be validated by a future similar
situation — and it means the loop's stability cannot be judged from one
session. It must be judged over a window of repeated situations (see §5).

### 4.2 Stability analysis: the entrenchment risk

A feedback loop can lock in its own errors. In this system, the failure
mode is **lesson entrenchment**: a wrong lesson becomes hard to dislodge,
because each time it fires, the agent follows it, and following it produces
behaviour consistent with the lesson — which looks, from inside the loop,
like confirmation. Four specific entrenchment paths exist:

- *Misdiagnosed root cause.* The Why field is required to be
  evidence-backed, but evidence can be misread, especially when a lesson
  is written quickly before retrying (as the protocol encourages). A lesson
  that attributes a failure to the wrong cause prescribes a prevention
  check that guards against the wrong thing, while the real cause recurs
  and gets attributed to yet another wrong cause.
- *Over-broad triggers.* If `error_signature` substrings are generic
  (common words, short fragments), the lesson fires in situations it was
  never meant for, and its prevention check adds friction or wrong
  constraints to unrelated work. Because lesson-check ranks by number of
  matched substrings, a broad lesson can outrank a specific, correct one.
- *Over-narrow triggers.* The mirror image: substrings so specific to one
  incident (a particular filename, a one-off error string) that the lesson
  never fires again, and the error repeats unprevented. The loop is then
  stable but useless — it converges to ignoring its own sensor.
- *No automatic decay of lesson authority.* The retrieval score's recency
  bonus decays with a 60-day half-life, but it maxes out at 0.5, while the
  lesson tier weight of 1.6 does not decay at all. An old lesson therefore
  retains most of its ranking power indefinitely. There is no built-in
  mechanism by which a lesson that stops being useful fades away on its
  own; fading requires human review (see below). A loop whose controller
  gain never decays is prone to exactly the lock-in described above.

There is also a subtler instability: *oscillation through correction*.
Suppose lesson A says "always do X" and a later incident produces lesson B
saying "never do X in situation Y." If their triggers overlap, the agent
can alternate between them across similar tasks depending on which
signature matches more substrings that day, without ever resolving the
underlying conflict. The store then holds two contradictory controllers,
and behaviour chatters between them.

### 4.3 Counter-mechanisms in this skill, and what they do not cover

The skill contains five genuine defences against entrenchment, each
operating at a different stage:

1. **Evidence requirement on the sensor.** The Why field must be
   evidence-backed and stated in one sentence. Forcing a single,
   evidence-tied sentence does not guarantee correctness, but it makes a
   wrong diagnosis *inspectable*: a reviewer (or a later agent) can see
   exactly what evidence the claim rested on and challenge it, rather than
   facing a vague "be careful next time."
2. **Specificity in the controller.** The Trigger field and the
   `error_signature` substrings are separate from the lesson prose, and
   lesson-check ranks by number of matched substrings before importance.
   A lesson that matches more of the current situation's specific features
   wins over a lesson that merely matches more generic ones — provided
   the signatures were written specifically. Specificity is thus rewarded
   by the ranking rule itself.
3. **User correction as an override, not a vote.** User corrections are a
   capture trigger for new lessons, and user-stated entries with
   importance ≥ 4 are protected from flagging or deletion without explicit
   user confirmation. The user is therefore not one more signal in the
   loop; the user is an external authority that can break a locked-in
   loop from outside it. This is the single most important stability
   feature in the design: no internal feedback loop should be able to
   outvote the user it serves.
4. **A review gate, not just a loop.** The verification gate (real checks
   against acceptance criteria, before reporting done) tests the plant's
   output independently of whether lessons were followed. An agent can
   follow every lesson and still fail verification — and that failure
   itself becomes a lesson, which can contradict and supersede the lessons
   that were followed. The gate is what lets the loop correct a wrong
   lesson, rather than merely reinforcing it.
5. **Human review of stale candidates, and file-level editability.** The
   stale listing (importance ≤ 2, no access in 180 days) surfaces
   candidates for a human to prune, and because the entry files are the
   source of truth (the index is rebuilt from them), correcting or
   deleting a lesson file corrects the system directly. Entrenchment is
   therefore reversible by editing one file — but only if someone reviews.

What these defences do *not* cover should be stated plainly. Nothing in
the skill automatically detects that two lessons contradict each other;
nothing automatically retires a lesson that repeatedly fires without
preventing the error; nothing measures whether following a lesson actually
reduced repeats (that measurement is the operator's job, §5); and the
stale listing only surfaces low-importance, long-unaccessed entries, so a
wrong high-importance lesson that fires often will never appear on it.
Stability in this design is therefore *supervised stability*: the loop is
built to be correctable, not to be self-correcting. An operator who never
reviews lessons, never acts on stale candidates, and never contradicts a
wrong lesson should expect entrenchment over time, not convergence.

## 5. Measurable metrics: is the memory getting better?

**A note on measurement honesty first.** Version 1.0.0 of this skill ships
no metrics dashboard and no analytics command. The metrics below are all
computable from the CLI surface that does exist — context, search,
lesson-check, list, get, index (including its stale listing), and export —
plus the entry files themselves (notably `access_count`, `updated_at`,
`importance`, and `confidence` in frontmatter, and the journal files in
`05_thinking-journal/`). Computing them requires counting CLI outputs over
a review window, by hand or with a small external tally; they are not
produced by the skill automatically. Any report of these metrics should say
over what window they were counted and by what counting rule, because the
skill itself does not standardise the window.

### 5.1 Lesson hit rate

*Definition.* Over a review window, consider every repeat-error event in
which an applicable lesson already existed in `04_procedural-lessons/`
before the event. The lesson hit rate is the fraction of those events in
which a lesson-check run *before* the retry returned the applicable lesson.
(A "repeat-error event" is an error whose signature matches a lesson's
recorded trigger situation; whether the lesson was applicable is judged
after the fact, from the lesson file, not from whether it fired.)

*How to measure.* For each repeat error in the window, record: was
lesson-check run before retrying, and did its output include the applicable
lesson? The numerator is events where the answer to both is yes; the
denominator is all repeat-error events with a pre-existing applicable
lesson. Session notes and journal Outcome sections are the raw record;
lesson-check output is the evidence.

*What it tells you, and what it does not.* A low hit rate localises the
failure: either lesson-check was not run (a protocol failure — the agent
skipped the controller), or it was run and missed (a signature failure —
substrings too narrow or too specific). A high hit rate does *not* prove
the lesson prevented anything; it proves only that the controller fired.
Prevention is measured by whether the error recurred *after* a hit, which
is the repeat-error rate conditional on a hit — the natural companion
metric to report alongside hit rate, lest a frequently firing but useless
lesson look successful.

### 5.2 Retrieval precision@k (proxy)

*Definition.* For a sample of searches (or context views) in a review
window, precision@k is the fraction of the top-k returned entries that were
actually used: opened in full (via get, or by reading the file after seeing
its router pointer) or cited in the subsequent work or journal. The "proxy"
qualifier is essential: the skill cannot observe whether the model
internally attended to an entry, so "used" is operationalised as an
observable follow-up action — a get, a file read, a citation in a journal
or lesson link — not as a claim about internal attention.

*How to measure.* Sample search outputs (query, returned ids, scores) and,
for each returned entry, check whether its `access_count` increased
afterward or whether it appears in the session's journal or output as a
reference. Precision@8 for search and precision@30 for context are reported
separately, because the two result sets have different size and purpose;
averaging them would hide which mechanism is noisy.

*What it tells you.* Falling precision@k with a growing store means ranking
is not keeping up with store growth — the top-k set is filling with weak
matches. Rising precision@k after a cleanup (dedupe, stale review,
importance correction) is evidence the cleanup helped. Precision@k says
nothing about recall: a precision of 1.0 is compatible with missing the
one entry that mattered, which is why it must be read alongside lesson hit
rate (for the lesson subset) and router coverage (for the always-loaded
subset).

### 5.3 Stale rate

*Definition.* Stale rate = (number of entries on the stale-candidate
listing) / (total number of entries in the store). The listing is defined
by the spec: importance ≤ 2 and no access in 180 days.

*How to measure.* Count the stale listing produced by the index command
and divide by the count from a full list (or from the exported store).
Report the raw counts alongside the rate, and split by tier if possible,
because a high stale rate concentrated in episodic records is benign
(session logs age naturally) while the same rate in semantic or lesson
tiers signals neglected review.

*What it tells you.* Stale rate is a hygiene gauge, not a quality verdict.
A rising stale rate means the store is accumulating entries nobody uses;
a rate driven to zero by aggressive deletion would be worse, because the
listing is a review prompt, not a deletion order. The healthy pattern is a
sawtooth: the rate climbs between reviews and drops when a human acts on
the listing. A flat, high stale rate means reviews are not happening.

### 5.4 Router coverage

*Definition.* Two numbers, reported together. (a) *Importance coverage*:
the fraction of entries with importance ≥ 4 (and, separately, of
user-stated entries) that are represented by a line in
`00_MEMORY_ROUTER.md`. (b) *Pointer integrity*: the fraction of router
lines that resolve to an existing entry file, and the headroom remaining
(40 minus lines used).

*How to measure.* Read the router, list the entry ids or files it points
to, and compare against a full list filtered to importance ≥ 4 (and to
confidence `user_stated`). Pointer integrity is checked by confirming
each pointed-to file exists and is retrievable. Both checks use only the
router file, the list output, and the entry files — no additional tooling.

*What it tells you.* Low importance coverage means the always-loaded set
is missing load-bearing entries: the agent starts each session blind to
something important unless it happens to search for it. Full coverage with
zero headroom is a different warning: the router is saturated, so the next
important entry will displace something, and truncation choices — not the
agent — will decide what the session starts with. Coverage and headroom
together describe whether the 40-line cap is a comfortable bound or a
binding constraint for this particular store.

### 5.5 Journal completion rate

*Definition.* Over a review window, journal completion rate = (number of
thinking journals that were closed with the Outcome section and the Lesson
link section filled in) / (number of journals started). A journal counts as
started when its file exists with Goal and Acceptance criteria; it counts
as completed only when Outcome is filled and the Lesson link is either a
lesson id or an explicit statement that no lesson arose.

*How to measure.* Count files in `05_thinking-journal/` created in the
window, and inspect each for filled Outcome and Lesson link sections.
Journal start, note, and close are CLI operations, but completion itself
is a property of the file contents, so this metric is measured by reading
the files, not by any single command's output.

*What it tells you.* Completion rate measures whether the thinking
protocol is actually being followed through, rather than started and
abandoned. A low rate with good outcomes is a warning about auditability,
not about quality: the work may be fine, but the reasoning that would let
a later session reconstruct *why* it was done is missing, and the
correction loop loses its record of what was considered and rejected.
Because the journal is the skill's substitute for unobservable reasoning
(§6), its completion rate is also, indirectly, a measure of how much of
the system's "thinking" is actually available for later audit at all.

## 6. Limits of this model (stated honestly)

1. **This is a qualitative and estimation model, not a physical law.**
   Nothing here was derived from first principles or fitted to data. The
   token arithmetic in §2 is an order-of-magnitude illustration from the
   spec's caps, with its assumptions labelled; the knapsack framing in §3
   is an analogy that organises trade-offs, not a theorem about this
   system; the control-loop analysis in §4 borrows stability vocabulary
   (gain, entrenchment, oscillation) to name failure modes, but no
   transfer function, stability margin, or convergence proof is offered,
   because none exists for a system whose "plant" is an agent doing open-ended work. Treat the model's predictions as hypotheses to check
   against the metrics in §5, not as guarantees.
2. **The skill cannot read hidden chain-of-thought, and neither can this
   model.** "Thinking" in this system means the thinking journal: a file
   the agent writes itself, before acting for tasks over ~3 steps, with
   goal, criteria, hypotheses, options considered and rejected with
   reasons, assumptions, verification plan, progress notes, outcome, and
   lesson link. A self-written journal can be incomplete, written
   post-hoc, rationalised after the fact, or simply wrong about why a
   decision was made. Writing it before acting reduces, but does not
   remove, that risk. Any claim that the system "remembers its reasoning"
   must be read with this qualification: it remembers the reasoning the
   agent *chose to record*.
3. **Nothing here guarantees convergence to "what the user intended."**
   The spec's honesty section (§0) is explicit: the skill maximises
   intent-match through acceptance criteria extracted at session start, a
   clarification loop for ambiguous / irreversible / costly requests, a
   verification gate before reporting done, and a lesson whenever output
   misses intent. Maximising is not guaranteeing. The correction loop can
   entrench wrong lessons (§4); retrieval can miss or misrank (§2, §3);
   scores are lexical proxies, not measures of truth; and user intent
   itself can shift between sessions. The metrics in §5 measure whether
   the system is improving on observable proxies — fewer repeat errors,
   higher precision in what is retrieved, cleaner hygiene, better router
   coverage, more complete journals. They do not, and cannot, certify
   that any particular output matches the user's unspoken intent.
4. **Values in the optimisation model are proxies, and proxies fail in
   correlated ways.** The retrieval score approximates value with token
   overlap, tier priors, importance priors, recency, and phrase matching.
   All of these can be wrong together — for example, for a novel task
   whose vocabulary does not overlap any stored entry, every score is
   low and ranking is near-arbitrary, while the most valuable entry (a
   general lesson about approaching novel tasks) may score worst of all.
   The model's "optimal" set is optimal only with respect to the proxy,
   and the gap between proxy and true value is unmeasured.
5. **Stability depends on a human operator, not on the mathematics.**
   The loop in §4 is correctable, not self-correcting. If nobody reviews
   lessons, acts on stale candidates, or contradicts wrong lessons, the
   model predicts gradual entrenchment and a slow decline in effective
   SNR — and it predicts this *without* any metric necessarily alarming,
   since a frequently firing wrong lesson can keep hit rate high while
   prevention fails. The honest conclusion is that this memory system is
   a supervised instrument: its long-run quality is bounded by the
   quality and frequency of human review, and no choice of weights or caps
   in the current design removes that bound.
