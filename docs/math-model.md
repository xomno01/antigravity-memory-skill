# Math Model — Antigravity Memory Skill

**Audience:** agents and developers implementing or auditing the skill.
**Status:** formalization and justification of the defaults in the coordinator
spec (`spec.md` §5 and §10). This document does **not** change any default.
Where this document suggests a value *could* be changed, it says so only in
§7 (PROPOSED CHANGES), which the coordinator decides at assembly time. The
main body (§1–§6) uses the spec defaults exactly.

**Honesty note on numbers in this document.** Every worked number in §4 and
§6 is a hand-computed illustration with small, invented inputs, chosen so the
reader can verify the arithmetic. None of it is measured on real user data,
real query logs, or a benchmark. No claim in this document should be read as
an empirical result.

---

## 1. Retrieval scoring — formalization

### 1.1 Objects

- A **query** $Q$ is a string supplied to search.
- A **document** $D$ is one memory entry: its normalized body text plus its
  metadata (`category`, `importance`, `updated_at`, `confidence`, `source`).
- The corpus has $N$ entries. $N$ is the number of entry files in the store
  at search time (router and index files excluded).
- For a term $t$ and document $D$, $\mathrm{tf}(t, D)$ and
  $\mathrm{df}(t)$ are defined below.

### 1.2 Tokenization

Tokenization is applied identically to the query and to every document body
(and, for the phrase check in §1.8, a normalized-string form is kept alongside
the token list):

1. Lowercase the whole string.
2. Split on every maximal run of non-alphanumeric characters. What remains
   are candidate tokens.
3. Drop every token of length < 2.
4. Drop every token on a small stopword list of common English and
   Vietnamese words (examples only, not the full list: English *the, and,
   of, to*; Vietnamese *và, của, là, các*). The list is deliberately small:
   it removes only words that almost never discriminate between entries.

Consequences worth stating plainly:

- Tokenization is **lexical, not semantic**: *crash* and *failure* are
  different tokens, however related their meanings are.
- Dropping 1-character tokens removes noise (single letters, stray digits)
  at the cost of losing genuinely meaningful 1-character symbols. That is
  an accepted trade-off for a zero-dependency, local scorer.
- The spec does not enumerate the stopword list exhaustively; the
  implementation's list is the operative one, and it must stay small. A
  large stopword list would silently delete content-bearing words (notably
  short Vietnamese function/content words) and change scores in ways this
  document cannot justify.

### 1.3 Matching, including prefix matching

A query token $q$ **matches** a document token $d$ iff

$$\text{match}(q, d) \iff d = q \;\; \text{or} \;\; d \text{ starts with } q.$$

Note the asymmetry, which is intentional and must not be "fixed" silently:
the *document* token must start with the *query* token, not the reverse.
A query for `render` matches a document containing `rendering` or
`renders`; a query for `rendering` does **not** match a document containing
only `render`.

Term frequency under prefix matching is then:

$$\mathrm{tf}(q, D) = \text{number of token occurrences in } D
\text{ that match } q.$$

Each document token occurrence is counted at most once per query token.
If a document contains both `render` and `rendering`, both occurrences
count toward $\mathrm{tf}(\text{render}, D)$ — that is the literal reading
of the spec's match rule, and §6 notes the noise this can create.

Document frequency is the count of documents containing at least one
matching token:

$$\mathrm{df}(q) = |\{ D : \mathrm{tf}(q, D) > 0 \}|.$$

**Coverage** (reported by search alongside the score, but *not* part of
the score — see §1.9) is:

$$\text{coverage}(Q, D) = \frac{|\{ q \in Q : \mathrm{tf}(q, D) > 0 \}|}{|Q|}.$$

Coverage answers "how much of the query does this entry touch at all?"
A score answers "how strongly?" They are different questions, and keeping
coverage out of the score is deliberate: an entry matching all four query
tokens weakly should not automatically outrank an entry matching two of
them with overwhelming evidence.

### 1.4 BM25-lite

For query $Q$ and document $D$, let $\mathrm{dl}(D)$ be the token count of
$D$ after tokenization, and let $\mathrm{avgdl}$ be the mean of
$\mathrm{dl}(D)$ over the corpus. The BM25-lite score is:

$$\mathrm{BM25}(Q, D) = \sum_{q \in Q}
  \mathrm{idf}(q) \cdot
  \frac{\mathrm{tf}(q, D) \cdot (k_1 + 1)}
       {\mathrm{tf}(q, D) + k_1 \cdot \left(1 - b + b \cdot \frac{\mathrm{dl}(D)}{\mathrm{avgdl}}\right)}$$

with the spec defaults

$$k_1 = 1.2, \qquad b = 0.75.$$

"Lite" means: a single text field (the entry body), no field weights, no
query-term weighting, and no relevance feedback. It is the classic BM25
term-saturation and length-normalization core, nothing more.

#### The idf, and why this smoothing

$$\mathrm{idf}(q) = \ln\left(1 + \frac{N - \mathrm{df}(q) + 0.5}{\mathrm{df}(q) + 0.5}\right).$$

This is the Robertson / BM25 idf with two adjustments, both worth
understanding:

1. **The $+0.5$ terms (add-half smoothing).** Without them, a term with
   $\mathrm{df} = 0$ would divide by zero, and a term with
   $\mathrm{df} = N$ would give $\ln(0)$. With them, every idf is finite:
   - $\mathrm{df} = 0$: $\mathrm{idf} = \ln(1 + (N + 0.5)/0.5) = \ln(2N + 2)$,
     large but finite. A query term matching nothing is rare, so if it
     *did* match, it would be highly informative — the formula reflects
     that without crashing.
   - $\mathrm{df} = N$ (term in every document):
     $\mathrm{idf} = \ln(1 + 0.5/(N + 0.5))$, a small positive number,
     approaching 0 as $N$ grows but never reaching it.
2. **The leading $1 + \dots$ inside the logarithm.** The classic BM25 idf,
   $\ln((N - \mathrm{df} + 0.5)/(\mathrm{df} + 0.5))$, goes *negative*
   whenever $\mathrm{df} > N/2$ — i.e. a term appearing in more than half
   the corpus would *subtract* from a document's score for containing it.
   That is defensible in some retrieval theories and confusing everywhere
   else: a user searching for a common word would see documents penalized
   for matching. The $1 + \dots$ form (the "positive idf" variant) floors
   the contribution at a small positive value instead. Common terms
   contribute little; they never punish a match. For a small personal
   memory store, where a term like `project` or `error` may genuinely
   appear in most entries, non-negative idf is the safer default.

Idf is strictly decreasing in $\mathrm{df}$: rarer terms weigh more.
That is the whole point — a match on `ffmpeg` should count for more than
a match on `the` (already stopworded) or on a word that appears in
every entry.

#### What $k_1 = 1.2$ does (term-frequency saturation)

Fix document length at the average ($\mathrm{dl} = \mathrm{avgdl}$), so
the length factor is 1 and the tf-component is
$\mathrm{tf} \cdot 2.2 / (\mathrm{tf} + 1.2)$. Then:

| tf | tf-component | gain over previous tf |
|----|--------------|-----------------------|
| 1  | 1.000        | —                     |
| 2  | 1.375        | +0.375                |
| 3  | 1.571        | +0.196                |
| 10 | 1.964        | → asymptote 2.2       |

The first occurrence matters most; the tenth barely matters. This is
saturation, and $k_1$ controls how fast it sets in:

- **Smaller $k_1$** (e.g. 0.5): saturation is faster; the score cares
  mostly about *whether* a term appears, not how often. Good for short
  entries where repetition is usually accidental.
- **Larger $k_1$** (e.g. 2.0+): the score stays closer to linear in tf;
  repetition keeps paying. That rewards long, repetitive documents and
  invites keyword-stuffing effects.
- **$k_1 = 1.2$** is the standard BM25 default for a reason: it is in the
  flat, forgiving middle. Doubling tf from 1 to 2 buys +37.5%, not +100%,
  so a genuinely topical entry still beats a one-word mention, but an
  entry cannot win by repeating one word ten times. Sensitivity to $k_1$
  is therefore moderate: moving it within roughly [0.8, 1.6] reorders
  close matches but rarely overturns a large BM25 gap.

#### What $b = 0.75$ does (length normalization)

The factor $1 - b + b \cdot \mathrm{dl}/\mathrm{avgdl}$ scales the
effective $k_1$. At $\mathrm{tf} = 1$:

| document length | length factor | tf-component |
|-----------------|---------------|--------------|
| $0.5 \times$ avgdl | 0.625 | 1.257 |
| $1.0 \times$ avgdl | 1.000 | 1.000 |
| $2.0 \times$ avgdl | 1.750 | 0.710 |

- **$b = 0$**: no length normalization at all. Long entries win simply
  by containing more words and hence more chances to match. In a store
  where one journal entry can be 10× a one-line fact, that is fatal.
- **$b = 1$**: full normalization; a term in a short document counts
  strictly more per occurrence. That over-rewards terse entries and
  penalizes legitimately detailed lessons.
- **$b = 0.75$**: strong but not total normalization — again the standard
  default, and again chosen because it is in the forgiving middle. A
  document twice the average length is penalized by ~29% per term, not
  halved; a document half the average length is boosted by ~26%, not
  doubled. Sensitivity is comparable to $k_1$: $b$ in [0.5, 0.9] shifts
  close rankings; it does not rewrite them.

### 1.5 Tier weights

Each entry category carries a multiplicative weight $w_{\text{tier}}$:

| category   | weight | why this rank (summary) |
|------------|--------|--------------------------|
| lesson     | 1.6    | Prevents a repeated, already-paid-for mistake; the highest insurance value per retrieval. |
| user       | 1.5    | Durable facts about the user; wrong or missing user facts corrupt every later turn. |
| preference | 1.4    | Durable choices about how the user wants things done; same logic as user, slightly narrower blast radius. |
| decision   | 1.2    | Past decisions constrain current work; contradicting one silently is a real failure mode. |
| project    | 1.1    | Project facts matter, but only while that project is active; slightly above neutral. |
| fact       | 1.0    | Neutral reference weight. The baseline everything else is measured against. |
| episodic   | 0.9    | Session logs and summaries; useful context, but perishable and often superseded. |
| other      | 0.8    | Uncategorized content; discounted precisely because nothing is known about its value. |

Two properties of this table matter for reasoning about scores:

- **The range is bounded and small: 0.8–1.6, a maximum ratio of 2.0.**
  Tier can reorder entries whose BM25 scores are within a factor of ~2,
  but it cannot rescue an entry with a BM25 near zero, nor overturn a
  BM25 gap of 3× or more on its own. Lexical relevance remains the
  primary signal; tier is a prior over *which kind* of relevant entry is
  most worth acting on.
- **The order is a judgment about cost of error, not frequency of use.**
  Lessons are not the most common category; they are the most expensive
  to ignore. If a future deployment measured actual retrieval utility per
  category, this table is the first thing to re-estimate from data
  (see §6 and §7) — it is a heuristic prior, not a fitted parameter.

### 1.6 Importance factor

$$\mathrm{f}_{\text{imp}} = 0.7 + 0.3 \cdot \frac{\text{importance}}{5},
\qquad \text{importance} \in \{1, 2, 3, 4, 5\}.$$

| importance | factor |
|------------|--------|
| 1 | 0.76 |
| 2 | 0.82 |
| 3 | 0.88 |
| 4 | 0.94 |
| 5 | 1.00 |

The design intent is visible in the numbers: the factor lives in
$[0.76, 1.00]$, a maximum ratio of only ~1.32 between the most and least
important entries. Importance *modulates* the score; it never dominates
it. An importance-1 entry with a strong lexical match still beats an
importance-5 entry with a weak one, which is correct — importance says
"this fact matters when it is relevant," not "show this fact regardless
of the query." The 0.7 floor exists for the same reason: even a trivial
entry keeps 76% of its BM25 score, so importance can never silence a
genuinely on-topic match.

Importance 5 is defined in the spec as "user-asserted or load-bearing."
That definition, not the arithmetic, is what gives §3 its force: a
user-asserted, load-bearing fact must not be quietly discarded by a
decay rule (§3.3).

### 1.7 Recency bonus

$$\mathrm{bonus}_{\text{recency}} = 0.5 \cdot 2^{-\mathrm{age\_days} / 60}.$$

$\mathrm{age\_days}$ is defined here as
$\max(0, (\text{now} - \text{updated\_at}) / 86400)$ — time since the
entry was last substantively updated, in days. (The spec states the
formula but does not name the timestamp; `updated_at` is the only
update timestamp the entry schema carries, so this document adopts it
explicitly rather than leaving the term undefined.)

**Half-life, stated plainly:** every 60 days, the bonus halves.

| age | bonus | fraction of fresh bonus |
|-----|-------|--------------------------|
| 0 days | 0.500 | 100% |
| 60 days | 0.250 | 50% |
| 120 days | 0.125 | 25% |
| 180 days | 0.0625 | 12.5% |
| 365 days | ~0.007 | ~1.5% |

Three consequences follow:

1. **Recency is additive, not multiplicative, and it is capped at 0.5.**
   It is added *after* BM25 × tier × importance. For a strong match
   (BM25-derived term ~8–14, as in §4), 0.5 is a tie-breaker, not a
   decider. For a weak match (BM25-derived term ~1–3), 0.5 can reorder
   close rivals. That asymmetry is intentional: recency should prefer
   the fresher of two *comparable* entries, never promote an irrelevant
   fresh entry over a relevant old one. An entry with BM25 = 0 can score
   at most 0.5 (plus phrase bonus if applicable) — it cannot outrank any
   entry with a real lexical match.
2. **60 days is a design choice, not a physical constant.** It encodes
   the judgment "in this kind of personal/project memory, a fact's
   *freshness signal* is worth half as much after two months." It is not
   derived from human memory research and must not be cited as such.
   A shorter half-life (e.g. 30 days) would aggressively prefer recent
   session notes over durable knowledge; a longer one (e.g. 180 days)
   would make recency nearly irrelevant for anything under a year old.
   60 days sits between "this week's work" and "last year's archive,"
   which matches how project memory actually gets reused.
3. **Recency decays the *bonus*, not the entry.** An old lesson does not
   lose its BM25 score with age; it only loses the small freshness
   top-up. Old entries remain fully retrievable on lexical merit, which
   is exactly what a lesson store needs — a two-year-old lesson about a
   recurring failure mode should still win when its trigger appears.

### 1.8 Exact-phrase bonus

$$ \mathrm{bonus}_{\text{phrase}} =
  \begin{cases}
    +2.0 & \text{if the normalized query string appears as a substring of the normalized entry content} \\
    0 & \text{otherwise}
  \end{cases} $$

"Normalized" here means the same lowercasing and whitespace collapsing
used for tokenization, applied to the whole string without splitting.
The bonus rewards contiguity and word order — evidence that the entry
is *about* the queried phrase, not merely containing its words scattered
across a long body.

Magnitude: +2.0 is large relative to the recency bonus (max 0.5) and
material relative to typical BM25-derived terms (roughly 3–14 in §4).
That is deliberate but deserves a clear-eyed note: because a phrase
match already implies all its tokens matched (raising BM25 itself), the
phrase bonus *double-counts* the phrase to some degree. The justification
is that contiguity is genuinely extra evidence — "ffmpeg volume render
crash" as one phrase is a different, stronger signal than those four
words in four paragraphs. The risk is that a long, common query phrase
(e.g. a sentence fragment the user happened to type) collects +2.0 for
many entries. In practice the bonus matters most for short, distinctive
queries, which is where it is most trustworthy.

### 1.9 Final score

$$\boxed{\;
\text{Score}(Q, D) =
  \mathrm{BM25}(Q, D) \cdot w_{\text{tier}}(D) \cdot \mathrm{f}_{\text{imp}}(D)
  \;+\; 0.5 \cdot 2^{-\mathrm{age\_days}/60}
  \;+\; \mathrm{bonus}_{\text{phrase}}(Q, D)
\;}$$

Reading the formula structurally:

- The **multiplicative core** (BM25 × tier × importance) is the
  relevance judgment. Its range is dominated by BM25 (unbounded above
  in principle, single digits to low teens for typical short entries),
  adjusted by at most 2.0× (tier) and 1.32× (importance).
- The **additive bonuses** (recency ≤ 0.5, phrase 0 or 2.0) are
  tie-breakers and contiguity evidence. They can reorder close scores;
  they cannot manufacture relevance from nothing (maximum combined
  bonus for a BM25 = 0 entry is 2.5, and that requires an exact-phrase
  match, which itself implies token matches, so a true BM25 = 0 entry
  can in fact only receive the recency bonus, ≤ 0.5).

`search` returns the top $N$ entries by this score (default $N = 8$),
each with its score and coverage (§1.3). Ties — rare with floating-point
scores, but possible for symmetric entries — should break deterministically
(e.g. higher importance, then more recent `updated_at`, then entry id)
so repeated identical searches are stable. Tie-breaking is a
presentation detail, not part of the score, and does not change rankings
except among exact ties.

`context` does **not** rank purely by this score. It returns the router
plus top entries by **category priority**:
user, preference, project, decision, lesson, fact, episodic, other.
That priority order differs from the tier-weight order (notably, lesson
ranks fifth for briefing presentation but first for search weight).
The difference is intentional: a session briefing should lead with who
the user is and what they are working on; a targeted search should lead
with the most error-avoiding match. Do not "fix" one order to match the
other — they serve different calls.

### 1.10 Lesson-check is a different scorer (do not conflate)

`lesson-check <text>` does not use the formula above at all. It returns
lessons whose `error_signature` substrings appear (case-insensitive) in
the text, ranked by number of matched substrings, then importance. That
is a trigger matcher, not a relevance ranker, and its simplicity is the
point: when an error message appears, substring matching on known
signatures is more reliable than BM25 over the error text. The two
scorers coexist; neither replaces the other.

---

## 2. Token-budget allocation under hard caps

### 2.1 The hard caps (spec §10, restated, not changed)

| constraint | cap | nature |
|------------|-----|--------|
| Router (`00_MEMORY_ROUTER.md`) | ≤ 40 lines | Hard cap enforced by `index`: truncation must guarantee it. |
| Rule file (`rules/memory-always-on.md`) | < 2 KB | Design target; official file cap is 24,000 bytes, aggregate across always-on + global rules is 20,000 tokens. |
| Rules aggregate | 20,000 tokens | Shared budget across *all* always-on and global rules, not this skill's alone. |
| `context` default | 30 items | Default, not a hard cap: `--max-items` may change it per call. |
| `search` default | 8 results | Default, not a hard cap: `--limit` may change it per call. |

The asymmetry matters: only the router line count is a hard, self-enforced
cap. The rest are defaults and shared budgets that must be managed by
discipline, because no code in this skill can enforce another skill's
rule size.

### 2.2 The optimization problem, stated honestly

Let each candidate briefing item $i$ have an expected value $v_i$ (how
much it helps the coming session) and a token cost $c_i$ (how much of
the context it consumes). The briefing problem is:

$$\text{maximize } \sum v_i \quad \text{subject to} \quad
\sum c_i \le B, \quad \text{per-tier caps and floors,}$$

where $B$ is the token allowance the caller is willing to spend on memory
briefing. This is a knapsack problem. The practical solution used here
is the standard greedy approximation, which is near-optimal when items
are small relative to $B$ (as one-line router entries and short excerpts
are):

1. **Estimate value density** $v_i / c_i$ for each candidate.
2. **Take items in decreasing density order** until the budget is full.
3. **Apply floors and caps**: guarantee a minimum for identity-bearing
   tiers (user, preference) even if their density is not the highest,
   and cap every tier so no single tier crowds out the rest. Floors
   protect against catastrophic omission (starting a session not knowing
   who the user is); caps protect diversity (a briefing that is 30
   episodic logs and no lessons is a failure even if each log scored
   well individually).

Value density is where the tier weights and importance enter budgeting:
a lesson's $v_i$ is high (tier 1.6, error-avoidance) and its $c_i$ is low
(a one-line trigger pointer in the router, a short excerpt in context),
so its density is the highest in the store. A user fact's $v_i$ is high
and persistent across sessions, so its density is high even at moderate
length. An episodic log's $v_i$ decays fast (it describes one session)
while its $c_i$ is often large (narrative text), so its density is low.
An `other` entry's $v_i$ is discounted by definition (tier 0.8, unknown
value), so it gets the smallest share. The allocation in §2.3 is this
reasoning turned into numbers.

### 2.3 Recommended allocation

#### Router: 40 lines

The router has six structural lines (title + five section headers:
`# Memory Router`, `## User`, `## Active projects`,
`## Key decisions`, `## Lessons — triggers`, `## Open threads`),
leaving 34 content lines. Entries within each section are truncated by
importance, then recency (spec §4). Recommended split:

| router section | lines | rationale |
|----------------|-------|-----------|
| `## User` | 8 | Identity and durable facts; the agent needs these before anything else. |
| `## Active projects` | 6 | Current work context; more than 6 active projects is a sign the list needs curation, not more lines. |
| `## Key decisions` | 6 | Constraints on current work; beyond 6, older decisions belong in full entries, not the router. |
| `## Lessons — triggers` | 10 | Highest density in the store: one line each (`trigger → file`), and the most expensive thing to miss. This is the largest section on purpose. |
| `## Open threads` | 4 | Loose ends and follow-ups; small because threads age fast and stale threads mislead. |
| Headers | 6 | Fixed structure. |
| **Total** | **40** | Hard cap, exactly met, never exceeded. |

Router lines point at entry files; the agent reads the full file on
demand (progressive disclosure). The router is therefore a *pointer
budget*, not a content budget — 40 lines buy orientation, not knowledge.

#### Context briefing: 30 items

| tier (briefing order) | max items | rationale |
|-----------------------|-----------|-----------|
| user | 6 | Floor-protected: identity first, even under pressure. |
| preference | 5 | Floor-protected: how the user wants things done. |
| project | 4 | Active-work context; capped so one project cannot dominate. |
| decision | 4 | Constraints; capped, older decisions via search. |
| lesson | 5 | High density; slightly fewer than user/preference in *count* because lesson *triggers* already occupy 10 router lines — the briefing complements, not duplicates, the router. |
| fact | 3 | Reference knowledge; search retrieves the rest on demand. |
| episodic | 2 | Lowest density among known tiers: long, perishable, session-specific. |
| other | 1 | Token of diversity only; anything more needs a category. |
| **Total** | **30** | The `context` default, exactly met. |

Note that the counts sum to the default, not to a hard cap: if a tier
has fewer entries than its allocation, the unused slots do **not**
automatically transfer to another tier in a way that breaks caps — the
briefing simply returns fewer items, unless the caller raises
`--max-items`. Transferring unused lesson slots to episodic logs would
defeat the purpose of the caps.

#### Rule file and aggregate

A rule file under 2 KB is roughly 500 tokens (at the usual planning
approximation of ~4 characters per token; this is an estimating rule of
thumb, not a measurement). Against the 20,000-token aggregate, that is
about 2.5% — small enough that forty such rule files could coexist
before the aggregate binds, and small enough that this skill is never
the reason another skill's rule gets squeezed out. The discipline to
maintain is: every sentence in the rule file must earn its place by
changing agent behavior at session start; anything that is merely
documentation belongs in `references/`, which costs nothing at session
start because it is read on demand.

#### Search: 8 results

Search has no per-tier quota, by design: its ranking *is* the allocation
mechanism (§1.9). Eight results is the right default because it is large
enough to include the best match from several tiers (a lesson, a user
fact, a project note) and small enough that the agent can actually read
all eight excerpts before choosing. Raising the limit to 20+ does not
raise recall proportionally — BM25 scores decay quickly past the top few
— but it does raise token cost linearly. Lowering it to 3–4 is
appropriate for a narrow, high-confidence lookup; raising it is
appropriate only for a genuinely broad, exploratory query.

### 2.4 When to increase or decrease

| situation | adjustment |
|-----------|------------|
| New user, or first session on a new project | Increase user/preference share (borrow from episodic/fact); identity errors early are the most expensive. |
| Error-prone or irreversible work (deploys, migrations, destructive commands) | Increase lesson share; run `lesson-check` *in addition to* context, since its trigger matcher (§1.10) catches what BM25 may miss. |
| Deep work inside a single project | Increase project/decision share for that project; decrease other projects' entries, not the user/lesson floors. |
| Context pressure (long session, large files already in context) | Decrease first: other → episodic → fact, in that order. Then truncate the router below 40 lines (the cap is a maximum, not a target) before touching user/preference/lesson floors. |
| Broad, exploratory question ("what do we know about X?") | Raise search `--limit` above 8 for that call only; do not raise the `context` default, which is a session-start cost paid on every session. |
| Narrow, high-confidence lookup ("what did we decide about Y?") | Lower search `--limit` to 3–4; a short, precise answer beats a long, diluted one. |
| Router persistently hitting 40 lines with important entries truncated | That is a curation signal, not a signal to raise the cap: merge, archive, or delete stale entries (§3) and split overgrown facts (body max 2,000 chars exists for this reason). |

The general rule: **floors are for identity and safety (user, preference,
lesson triggers); caps are for everything else; and the first thing to
cut under pressure is always the most perishable, least categorized
content.**

---

## 3. Forgetting thresholds

### 3.1 The policy (spec §10, restated exactly)

- **Flag as a stale candidate** for user review: an entry with
  **importance ≤ 2 AND no access in 180 days**.
- **Never flag or delete without explicit user confirmation:** an entry
  with confidence `user_stated` **and** importance ≥ 4.
- **The system never auto-deletes anything.** The `index --stale` listing
  is a proposal list. Deletion happens only when the user (or an agent
  acting on the user's explicit instruction for that entry) issues a
  delete. A flagged entry remains fully searchable until the user decides.

"Flag" therefore means three things and only three things: the entry
appears on a review list, a human is asked to confirm or dismiss, and
nothing about the entry's retrievability changes in the meantime.

### 3.2 A forgetting curve for low-value entries

For entries that are *not* user-asserted durable facts, expected future
utility decays with disuse. This document models that decay with the same
exponential form as the recency bonus, because it keeps the model to one
decay law instead of two:

$$V(t) = V_0 \cdot 2^{-t / 60},$$

where $V_0$ is the entry's value when fresh and $t$ is days since last
access. This is a *modeling choice for the review threshold*, not a
claim about human memory (Ebbinghaus-style curves are typically written
as $R = e^{-t/S}$ with a fitted strength $S$; the half-life form above
is the same family with $S = 60 / \ln 2 \approx 86.6$ days, chosen to
match the recency half-life so the system has one clock, not two).

Under this model, after 180 days without access — three half-lives —
an entry retains $2^{-3} = 12.5\%$ of its fresh value. Its recency bonus
has fallen from 0.500 to 0.0625, below the noise floor of ordinary score
differences (typical BM25-derived terms are in the units, phrase bonus
is 2.0). The entry is not *worthless* — 12.5% is not zero — but it has
crossed from "plausibly useful" into "needs a human to say whether it
still matters."

Why the threshold is a **conjunction** (low importance AND long
inactivity), not either condition alone:

- **Low importance alone is not enough.** A fresh importance-1 entry
  may be trivial, but it costs almost nothing to keep (one small file,
  one index row) and flagging every new trivial entry would spam the
  user with review work that exceeds the storage saved. Review attention
  is the scarce resource, not disk.
- **Long inactivity alone is not enough.** A rarely-needed entry can be
  load-bearing precisely *because* it is rarely needed: the runbook for
  a yearly migration, the constraint a user stated once and never
  repeated, the lesson for a failure mode that happens twice a year.
  Inactivity is weak evidence about such entries, so inactivity alone
  must never flag them.
- **Together, they are strong evidence.** If an entry was judged
  low-value when written (importance ≤ 2) *and* nothing in 180 days has
  retrieved it, both the author's prior and the usage record agree that
  it is not pulling its weight. The conjunction is what keeps the false
  positive rate low: it flags entries where two independent signals
  point the same way.

Why 180 days, specifically: it is three recency half-lives (3 × 60),
which makes it a natural multiple of the system's existing clock rather
than an arbitrary round number. At 90 days (1.5 half-lives, 35% value
retained) too many seasonally-used entries would be flagged — quarterly
work, for example, legitimately goes 90 days unaccessed. At 365 days
(6 half-lives, 1.6% retained) the store would accumulate a year of
low-value entries before anyone looked, and the review list would be
large enough to be ignored. 180 days is the point where the decay curve
has flattened (further waiting buys little extra discrimination) while
the review list stays small enough to actually be reviewed.

Access resets the clock: any retrieval that surfaces the entry (a search
hit the agent reads, a context inclusion, an explicit `get`) counts as
access and restarts the 180-day window. An entry that is genuinely used,
however rarely, never becomes a candidate as long as its use recurs
within 180 days.

*Implementation note (not a spec change):* the entry schema carries
`access_count` but no `last_accessed_at` timestamp, and `updated_at`
records substantive edits, not reads. For the "no access in 180 days"
test to be computable, the implementation must define "last access"
operationally — for example, by advancing `updated_at` on access, or by
recording a last-access time in the index. This document states the rule
as specified and flags the operational definition as a coordinator
decision (see §7); it does not silently invent a schema field in the
main model.

### 3.3 Why user-stated, importance ≥ 4 entries are never flagged

Three independent arguments converge; any one of them would suffice.

1. **Provenance.** `user_stated` means the content came from the user,
   not from inference, tool output, or a session summary. Inferred
   content can decay in credibility; user-asserted content does not
   decay — it remains true until the user changes it. Applying a
   forgetting curve designed for inferred/episodic content to asserted
   identity facts is a category error. A preference the user stated two
   years ago and never repeated is not "forgotten"; it is *still their
   preference*, and silently flagging it invites the agent to act as if
   it were not.
2. **Asymmetric cost.** The cost of keeping one extra entry is tiny
   (one file under 2,000 characters, one index row, a negligible effect
   on idf statistics). The cost of losing a load-bearing user fact is
   large and often silent: the agent proceeds confidently on a wrong
   assumption, and the user discovers the error only after the work is
   done. When costs are this asymmetric, the rational policy is to
   require explicit human confirmation before even *proposing* removal.
   The spec's "never flag without explicit user confirmation" is that
   policy, stated as a rule.
3. **Importance ≥ 4 means load-bearing by definition.** The spec defines
   importance 5 as "user-asserted or load-bearing" and the 4–5 band as
   the top of the scale. An entry in that band is, by its own metadata,
   the kind of entry other work depends on. A decay rule that overrode
   that metadata on the basis of mere inactivity would contradict the
   entry's own classification. The conjunction in §3.1 therefore has a
   mirror image here: `user_stated` AND importance ≥ 4 is a double
   lock — trusted source *and* high stated value — and both locks must
   be respected until the user personally turns a key.

Note the boundary carefully: an entry that is `user_stated` but
importance ≤ 3, or importance ≥ 4 but merely `inferred`, is **not**
covered by the never-flag rule. It may still be flagged under §3.1 if
it also meets importance ≤ 2 and 180 days without access (in practice,
only the low-importance case can meet both). The exemption is narrow
by design: it protects exactly the entries where both provenance and
value are highest, and nothing else.

### 3.4 What forgetting is not

- It is not deletion. No entry is removed by any automatic process.
- It is not hiding. Flagged entries stay in the index and in search.
- It is not decay of the score. Old entries lose only the recency bonus
  (§1.7); their BM25 score is age-independent.
- It is not a judgment that the entry is false. Staleness means
  "unaccessed and low-valued," not "wrong." A stale entry may be
  perfectly true and simply no longer needed — which is why a human,
  not a threshold, makes the final call.

---

## 4. Worked examples (hand-computed illustrations, not measurements)

All arithmetic below was computed by hand from the invented inputs
shown. Round to three decimals; small rounding differences do not
change any ranking.

### 4.1 Example (a): one retrieval query, four entries

**Query:** `ffmpeg volume render crash`

Tokenization (§1.2): lowercased, split, all four tokens survive
(length ≥ 2, none stopwords). So $Q = \{\text{ffmpeg}, \text{volume},
\text{render}, \text{crash}\}$.

**Corpus assumptions (invented for this example):** $N = 20$ entries,
average document length $\mathrm{avgdl} = 40$ tokens.

Document frequencies (invented):

| query token | df | idf = ln(1 + (20 − df + 0.5)/(df + 0.5)) |
|-------------|----|-------------------------------------------|
| ffmpeg | 4 | ln(4.667) = 1.540 |
| volume | 3 | ln(6.000) = 1.792 |
| render | 6 | ln(3.231) = 1.173 |
| crash | 2 | ln(8.400) = 2.128 |

Note that `crash`, the rarest term, correctly gets the largest idf.

**The four candidate entries (invented):**

| entry | category (tier) | importance (factor) | age (recency bonus) | dl | token counts (tf) | phrase? |
|-------|-----------------|---------------------|---------------------|----|--------------------|---------|
| A | lesson (1.6) | 5 (1.00) | 10 days (0.445) | 32 | ffmpeg 2, volume 2, render 1, crash 1 | no |
| B | fact (1.0) | 3 (0.88) | 90 days (0.177) | 48 | ffmpeg 1, volume 1, render 2, crash 0 | no |
| C | episodic (0.9) | 2 (0.82) | 5 days (0.472) | 60 | ffmpeg 1, render 1 via prefix match on `rendering`, crash 1, volume 0 | no |
| D | user (1.5) | 4 (0.94) | 200 days (0.050) | 24 | ffmpeg 1, volume 1, render 1, crash 1 | yes — body contains the exact string "ffmpeg volume render crash" |

Recency bonuses use §1.7: $0.5 \cdot 2^{-\text{age}/60}$.
For A: $0.5 \cdot 2^{-10/60} = 0.5 \cdot 0.891 = 0.445$.
For B: $0.5 \cdot 2^{-90/60} = 0.5 \cdot 0.354 = 0.177$.
For C: $0.5 \cdot 2^{-5/60} = 0.5 \cdot 0.944 = 0.472$.
For D: $0.5 \cdot 2^{-200/60} = 0.5 \cdot 0.099 = 0.050$.

**BM25 computation** ($k_1 = 1.2$, $b = 0.75$; the length factor is
$1.2 \cdot (0.25 + 0.75 \cdot \mathrm{dl}/40)$):

- **A** (dl 32, length factor 1.02). Per-term tf-components:
  ffmpeg tf 2: $4.4 / 3.02 = 1.457$; volume tf 2: $1.457$;
  render tf 1: $2.2 / 2.02 = 1.089$; crash tf 1: $1.089$.
  BM25 = $1.457 \cdot 1.540 + 1.457 \cdot 1.792 + 1.089 \cdot 1.173
  + 1.089 \cdot 2.128 = 2.244 + 2.611 + 1.277 + 2.318 = 8.450$.
- **B** (dl 48, length factor 1.38). tf-components: tf 1: $2.2/2.38
  = 0.924$; render tf 2: $4.4/3.38 = 1.302$; crash tf 0: 0.
  BM25 = $0.924 \cdot 1.540 + 0.924 \cdot 1.792 + 1.302 \cdot 1.173
  + 0 = 1.423 + 1.656 + 1.527 = 4.606$.
- **C** (dl 60, length factor 1.65). tf-components: tf 1: $2.2/2.65
  = 0.830$ for each of ffmpeg, render (prefix match on `rendering`),
  crash; volume 0.
  BM25 = $0.830 \cdot 1.540 + 0.830 \cdot 1.173 + 0.830 \cdot 2.128
  = 1.278 + 0.974 + 1.766 = 4.018$.
  Coverage for C is 3/4 = 0.75 — reported, but not scored (§1.3).
- **D** (dl 24, length factor 0.84). tf-components: tf 1: $2.2/1.84
  = 1.196$ for each term.
  BM25 = $1.196 \cdot (1.540 + 1.792 + 1.173 + 2.128)
  = 1.196 \cdot 6.633 = 7.933$.

**Final scores** (§1.9):

| entry | BM25 × tier × importance | + recency | + phrase | **final** |
|-------|--------------------------|-----------|----------|-----------|
| A | 8.450 × 1.6 × 1.00 = 13.520 | + 0.445 | + 0 | **13.965** |
| D | 7.933 × 1.5 × 0.94 = 11.186 | + 0.050 | + 2.000 | **13.236** |
| B | 4.606 × 1.0 × 0.88 = 4.053 | + 0.177 | + 0 | **4.230** |
| C | 4.018 × 0.9 × 0.82 = 2.965 | + 0.472 | + 0 | **3.437** |

**Ranking: A > D > B > C.** A search with default limit 8 returns all
four, in this order.

What the example demonstrates:

- A wins on the strength of its BM25 (it matches all four terms, twice
  for the two most common ones) amplified by the highest tier weight.
  Its recency bonus is incidental.
- D nearly catches A despite a lower BM25 and a 200-day-old recency
  bonus of only 0.050, because the user tier (1.5), high importance
  (0.94), and the +2.0 phrase bonus stack. This is the formula working
  as designed: a user fact containing the exact queried phrase *should*
  nearly top the list. Note also that D's age barely hurt it — its BM25
  was untouched by age (§1.7, point 3).
- B beats C despite C being far fresher (5 days vs 90 days), because
  B's BM25 is higher and its tier/importance are better. Recency (0.472
  vs 0.177, a difference of 0.295) could not close a gap of over 1.0 in
  the multiplicative core. That is the intended asymmetry of §1.7.
- C shows prefix matching in action (`render` matching `rendering`)
  and its limit: the match counted, but C still ranked last because it
  missed `volume` entirely and carries the lowest tier and importance
  of the four.

### 4.2 Example (b): token budget for one working session

**Planning assumptions (illustrative only, not spec caps and not
measured):** the caller allows 3,000 tokens for the session-start memory
briefing; a router line averages ~15 tokens; the rule file (< 2 KB)
costs ~500 tokens; a context item is shown as an excerpt (title plus
first lines) averaging ~60 tokens, with the full entry read on demand
afterwards (progressive disclosure). Under these assumptions:

| component | quantity | tokens |
|-----------|----------|--------|
| Router (40 lines × 15) | 40 lines | 600 |
| Rule file (< 2 KB) | 1 file | 500 |
| Context excerpts — user (6 × 60) | 6 items | 360 |
| Context excerpts — preference (5 × 60) | 5 items | 300 |
| Context excerpts — project (4 × 60) | 4 items | 240 |
| Context excerpts — decision (4 × 60) | 4 items | 240 |
| Context excerpts — lesson (5 × 60) | 5 items | 300 |
| Context excerpts — fact (3 × 60) | 3 items | 180 |
| Context excerpts — episodic (2 × 60) | 2 items | 120 |
| Context excerpts — other (1 × 60) | 1 item | 60 |
| **Briefing total** | **30 items + router + rule** | **2,900** |
| Slack (formatting, headers) | — | 100 |
| **Allowance** | — | **3,000** |

The session-start briefing therefore fits with 100 tokens to spare —
but only because items are excerpts. If the same 30 items were instead
read in full at an illustrative ~300 tokens each, they alone would cost
9,000 tokens, triple the allowance. That gap is the entire argument for
progressive disclosure: the router and excerpts buy orientation cheaply,
and full reads are spent only on entries the agent actually needs.

**Mid-session search, same session (separate from the briefing):**
one search at the default limit of 8 returns 8 excerpts at ~60 tokens
= ~480 tokens. Reading 2 of them in full at ~250 tokens each adds ~500
tokens. Total search cost for that call: ~980 tokens, spent only because
a specific question arose. This is why the search default (8) is much
smaller than the context default (30): search is a targeted, repeatable
call, so its per-call cost must stay low; context is a once-per-session
briefing, so it can afford breadth.

**Under pressure (allowance halved to 1,500 tokens):** the router (600)
and rule file (500) are fixed costs totaling 1,100, leaving only 400
tokens — about 6 excerpts. Greedy by density (§2.2) with floors intact
keeps, in order: user 3, preference 2, lesson 1–2, and drops episodic,
other, and fact entirely for this session. The lesson count falls, but
the lesson *triggers* are still in the router's 10 lines, so the safety
net survives even when the briefing shrinks. If pressure tightens
further, the router itself is truncated below 40 lines (the cap is a
maximum, not a target) before user/preference floors are touched.

---

## 5. Limits of the model (stated honestly)

1. **BM25-lite does not understand meaning.** Synonyms, paraphrases,
   and related concepts score zero unless they share tokens or prefixes.
   *Crash*, *failure*, *abort*, and *exception* are unrelated as far as
   this scorer is concerned. The mitigation in this skill is not a
   better scorer — it is the lesson-check trigger matcher (§1.10), good
   tagging discipline, and the agent's judgment in choosing query terms.
   Anyone claiming this retrieval "understands" the user's intent is
   overstating it.
2. **Prefix matching creates noise, by construction.** Short query
   tokens match many document tokens: `re` matches `render`, `read`,
   `record`, `restart`, and everything else starting with `re`; `in`
   matches a large fraction of English vocabulary. Because prefix
   matches count fully toward tf, a short query token can inflate the
   BM25 of entries that are topically unrelated. The spec's token-length
   filter (drop tokens < 2 characters) only partly helps — 2-character
   prefixes are still very broad. Users and agents should prefer
   query tokens of 3+ characters for discriminative searches, and the
   implementation should consider the prefix-length refinement in §7.
3. **Tier weights are heuristics, not fitted parameters.** The values
   1.6 down to 0.8 encode reasoned judgments about cost of error (§1.5),
   but they have not been optimized on any real retrieval data, because
   no such data exists for this store yet. If usage logs later show
   that, say, project entries are retrieved and acted on far more often
   than lessons, the honest response is to re-estimate the weights from
   that data — not to defend 1.6 on principle.
4. **The 60-day half-life is a design choice, not a constant of nature.**
   It is not derived from human forgetting research, from this user's
   behavior, or from any measurement. It is a reasonable middle value
   that makes recency a tie-breaker rather than a decider (§1.7). A
   different user with weekly project cycles or yearly cycles might
   rationally want 30 or 120 days. The half-life should be revisited
   once access patterns are observable.
5. **The forgetting threshold inherits the same honesty constraint.**
   "Importance ≤ 2 and 180 days without access" is a reasoned policy
   (§3.2), not an empirically validated classifier. Its false-positive
   and false-negative rates are unknown, because no labeled set of
   "entries the user later wanted back" exists. The safeguard is
   procedural, not statistical: the system never deletes, so a wrong
   flag costs a moment of review, not a lost fact.
6. **Small-corpus statistics are unstable.** With $N$ in the tens, a
   single new entry can move df values and `avgdl` noticeably, shifting
   scores between sessions for identical queries. Scores are therefore
   comparable *within* one search at one moment, not across time as
   absolute measures of an entry's worth. Never log a score as if it
   were a stable property of the entry.
7. **The model scores entries independently.** It has no notion of
   redundancy (three near-duplicate entries can occupy the top three
   search slots), contradiction (two entries asserting opposite facts
   both score highly), or coverage of the query's aspects. Deduplication
   on save (spec §4) mitigates redundancy at write time, but it cannot
   remove near-duplicates that differ in wording. Ranking diversity and
   contradiction detection are out of scope for this scorer and would
   belong in a later layer, not in a tweak to these weights.

---

## 6. Summary of the model (for implementers)

- Tokenize: lowercase, split on non-alphanumeric, drop length < 2,
  drop a small EN+VI stopword list.
- Match: document token equals query token, or starts with it.
- $\mathrm{idf} = \ln(1 + (N - \mathrm{df} + 0.5)/(\mathrm{df} + 0.5))$;
  $k_1 = 1.2$; $b = 0.75$.
- Tier weights: lesson 1.6, user 1.5, preference 1.4, decision 1.2,
  project 1.1, fact 1.0, episodic 0.9, other 0.8.
- Importance factor: $0.7 + 0.3 \cdot \mathrm{importance}/5$.
- Recency bonus: $0.5 \cdot 2^{-\mathrm{age\_days}/60}$,
  $\mathrm{age\_days}$ from `updated_at`, half-life 60 days.
- Phrase bonus: +2.0 on exact normalized-phrase substring match.
- Final: $\mathrm{BM25} \cdot w_{\text{tier}} \cdot \mathrm{f}_{\text{imp}}
  + \mathrm{bonus}_{\text{recency}} + \mathrm{bonus}_{\text{phrase}}$.
- Router ≤ 40 lines; rule file < 2 KB within a 20,000-token aggregate;
  context default 30 items (allocation §2.3); search default 8.
- Stale candidates: importance ≤ 2 AND no access in 180 days, listed
  for user review only. User-stated AND importance ≥ 4: never flagged
  without explicit user confirmation. Nothing is ever auto-deleted.

---

## 7. PROPOSED CHANGES (for coordinator decision at assembly — NOT adopted)

Nothing in this section changes the spec or the model in §1–§6. These
are the mathematician's suggestions, offered for the coordinator to
accept, modify, or reject. If rejected, the spec defaults stand as
documented above.

1. **Define "last access" operationally.** The schema has
   `access_count` but no `last_accessed_at`, so "no access in 180 days"
   (§3) is not directly computable from entry files alone. Proposal:
   record a last-access timestamp in `index.json` (not in the entry
   file, to avoid rewriting the entry on every read), and define the
   staleness test against it, with `updated_at` as fallback. This is a
   schema/implementation clarification, not a change to the threshold.
2. **Require query tokens of length ≥ 3 for prefix matching.**
   Two-character prefixes (§5, point 2) are the noisiest case. Proposal:
   keep exact matching for 2-character tokens, but apply the
   starts-with rule only when the query token has length ≥ 3. This
   narrows prefix noise without changing any weight or default.
3. **Use coverage as a deterministic tie-breaker, not a score term.**
   Proposal: when two entries' final scores are within a small epsilon
   (e.g. 0.01), rank the higher-coverage entry first, before falling back
   to importance/recency/id. This preserves the score formula exactly
   while making near-ties prefer entries that touch more of the query.
4. **Revisit tier weights and half-life after real usage exists.**
   Proposal: once the store has sustained usage, log (locally, without
   content) which retrieved entries the agent actually reads in full,
   and re-estimate tier weights and the half-life from that signal.
   Until such data exists, keep the spec defaults — do not tune by
   intuition alone.

---

*Sources: coordinator spec `spec.md` §5 (retrieval scoring defaults) and
§10 (token budget and forgetting policy), which this document formalizes
without altering. All worked numbers are hand-computed illustrations.*
