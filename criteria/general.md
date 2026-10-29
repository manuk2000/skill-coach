# General criteria

The rules every connected skill is scored by. The judge reads this file together
with the skill's own `references/rubric.md`. Where the two overlap, **the rubric wins
on thresholds**, but a rubric can never remove a criterion from this file.

This file is part of the plugin. It never changes automatically: a fix aimed at it
always waits in `proposals.md`, and the change is made in the plugin's repo and
released.

---

## Scoring

- Every score starts at **10**; deductions subtract. Never build upward from zero —
  the default assumption is that a run was fine.
- A skill's rubric defines up to two families: **result** (was the answer right) and
  **efficiency** (was it reached without waste), each scored per **unit of work**
  (one request, one file, one item — whatever the rubric names). A skill with no
  countable unit has a result family only.
- **Report the mean, trigger on the min.** The number shown to the user is the mean
  over units; the decision to fix uses the lowest unit. One bad unit must never be
  averaged away by nine good ones.
- **`n/a` is a valid score.** A run that never completed a unit of work (backend
  unreachable, aborted early) scores `n/a`, never 0 and never 10, and triggers
  nothing by itself.
- **Score the answer the user actually received** — the final answer in the
  transcript — never a caller's summary of it.

## Bands

Identical for every skill. Always show the band with the number, never a bare number.

| Band | Score |
|---|---|
| 🟢 | 8.0–10 |
| 🟡 | 5.0–7.9 |
| 🔴 | 0–4.9 |

## General criteria

Judged for every skill, in addition to its own rubric.

| Key | Criterion | Deduct |
|---|---|---|
| `general.contract-broken` | the output did not follow the skill's own declared output contract | −3 |
| `general.user-corrected` | the user had to correct the result | −3 |
| `general.user-reasked` | the user had to ask the same thing again in a different way | −2 |
| `general.silent-truncation` | results were truncated or sampled without saying so | −3 |
| `general.count-without-denominator` | a count was reported without the total it is out of | −2 |
| `general.improvised-step` | a step was unclear enough that it had to be improvised | −2 |
| `general.repeated-workaround` | the same manual workaround was applied again | −2 |
| `general.scope-exceeded` | the skill did work beyond what it says it does | −2 |
| `general.unvalidated-identifier` | a name or id was used without checking that it resolves | −1 |
| `general.effort-mismatch` | the run cost far more than the task's difficulty warranted | −2 … −4, see below |
| `general.no-budget-declared` | the skill declares no expected cost, so an overrun cannot be measured | −1 |
| `general.oversized-result` | a result ≥ the limit came into the run's context when a narrower fetch would have done: filter or limit at the source, count or probe size first, project only the needed fields, hand the bulk to a subagent, or reuse a copy already fetched | −2; −3 when the same large payload was fetched twice |
| `general.model-mismatch` | a subagent's model did not fit its job by "Choosing a subagent's model": too strong (a stronger model only fetched, counted or filtered), too weak (the main session had to redo or correct its output), or a subagent was started for data small enough to read directly | −2 |
| `general.secret-exposed` | a secret **value** appeared in output or notes (a name or a location is fine) | **−10** |

- `general.contract-broken` does not fire on an aborted run when the skill defines no
  shape for an incomplete run — there was no contract to break. Score `n/a`.
- `general.secret-exposed` is −10 by design: one occurrence fails the run outright.
  Report it before anything else.
- `general.count-without-denominator` is the preventive form of
  `general.silent-truncation`. Truncation fires when data was dropped and that was
  hidden; this one fires on any bare count, even a complete one, because "34 rows"
  and "34 of 39 rows" read the same to the writer and very differently to the
  reader. The total is whatever makes the number checkable: pages read of pages that
  exist, rows compared of rows in scope. If no total is knowable, say so — "34
  found, total unknown" is honest, "34 found" is not.
- The limit for `general.oversized-result` is `large_result_kb` in the data folder's
  `config.json` (the skill's own entry, else the defaults; 40 when missing), in KB of
  text. Images and documents never count. A result refused as "exceeds maximum
  allowed tokens" counts as oversized.
- `general.oversized-result` and `general.model-mismatch`: no deduction when the user
  asked to see the full payload. A valid fix changes the method, as for
  `general.effort-mismatch`: the narrower fetch, or the right model named in the
  skill's own step.
- A large result inside a subagent is judged only by `general.model-mismatch`.
  Keeping the bulk out of the run's context was right; the only question is whether
  the model fit the job.

### `general.effort-mismatch`

When a run costs far more than its difficulty warranted, the first hypothesis is
not that the task was hard. It is that **the approach was wrong**. The question is
always: *what would someone who already knew the answer have done, and how many steps
would that have taken?* The gap between that and what happened is the finding.

Classify the run by shape:

| Tier | Shape | Sane ceiling |
|---|---|---|
| lookup | one fact, one source | ~1 min |
| survey | one question across many items of one kind | ~3 min |
| synthesis | facts from several sources, combined into a judgement | ~8 min |
| investigation | scope unknown at the start, narrowed step by step | none — but it must report progress as it goes |

If the skill declares an expected budget, score actual against declared. If not,
score against the tier ceiling and also fire `general.no-budget-declared`.

| Overrun | Deduct |
|---|---|
| ≤ 2× | none |
| 2–4× | −2 |
| 4–10× | −3 |
| > 10× | −4 |

- Cost is what the user felt: **wall-clock first**. Token and call counts are the
  diagnosis, not the measure.
- When a same-session control exists (the same kind of task done quickly earlier in
  the session), it beats the tier ceiling. Show both numbers so the choice can be
  checked.
- **A valid fix changes the method, not the number.** Lowering a budget without
  changing the approach turns a slow run into a slow and incomplete one. "Be more
  efficient" is a restatement of the finding, not a fix. Name a different way:
  fetch less and drill in, do the cheap disambiguating step first, batch what was
  serial, stop delegating work that needs no reduction. If no better method can be
  named, record the run as genuinely hard.

## Choosing a subagent's model

`general.model-mismatch` is judged by this table. Models are named by alias.

| What the subagent must do with the data | Model |
|---|---|
| fetch it, then count, filter or pick fields — no judgement | `haiku` |
| group it, compare it, read a trace or stack and say what matters | `sonnet` |
| decide, interpret, recommend | no subagent — the main session |
| the data is small (under ~10 KB) | no subagent — read it directly |

A skill whose subagent jobs differ (one counts, another groups) chooses per job, not
one model for all. A fix writes that choice into the skill's own step that starts the
subagent: a skill cannot rely on reading plugin files while it runs.

## When to fix

A fix is chosen when **any** of these holds:

| Trigger | Threshold |
|---|---|
| the run's general score | below 8 |
| any single unit of work | below 7 — a rubric may set its own number |
| any must-not in the skill's rubric | always, whatever the score |
| `general.effort-mismatch` | at −3 or worse, always |
| `general.oversized-result`, on a run where run-end passed a cost note | always |
| `general.model-mismatch` | always, on any scored run — a spot check included |
| a lasting request (see "Requests") | always |
| `general.secret-exposed` | always, reported first |

- An abort triggers nothing by itself — record the cause and stop. The must-nots are
  still judged: claiming "all healthy" because a backend was unreachable is a wrong
  answer, not an abort.
- Nothing breached → no fix. The footer shows the score and nothing else.
- **Always:**
  - At most one change per run. If several qualify, the largest deduction wins; the
    rest are recorded and counted as held back. A lasting request has no deduction:
    it is chosen over the others unless the user corrected the run — then the
    request is held back and the largest deduction wins.
  - Never delete existing content. The one exception is a pointer edit (see "Text or
    logic"). Never change a safety or permission rule automatically.
  - Change one section; integrate into an existing section. A family change edits one
    section of a file in the family folder, plus the pointer edits that replace its
    copies. Never append a "learnings" changelog to the end of a `SKILL.md` — a list
    at the end is read last and followed never.
  - Ignore evidence from runs older than the last change that addressed the same
    problem key.
  - No second pending proposal for the same problem key within 30 days.
  - Never write a secret value. Record where it lives, never what it is.

## Requests

A request is something the user asked of the run that the skill has no step for, so
the run improvised it — in the prompt that started the run, or in a message after
the footer ("add this to the skill", "do this every time").

- **No score penalty.** Doing what the skill never claimed is not a defect, and
  neither is improvising it: `general.improvised-step` and `general.scope-exceeded`
  do not fire for a request. The run is scored as usual.
- **Lasting or one-off.** Lasting when the user said so ("add", "always", "next
  time", "from now on"), or when the request is a new instance of what the skill
  exists to do (a new kind of item for a skill that keeps a list of them). One-off
  when it is about this case's data only. **When unsure, it is one-off**: it is
  recorded in the notes as a `gap` problem, and the second time the same key is seen
  it counts as lasting.
- **Out of scope.** A request outside the skill's declared purpose is never added. It
  is recorded, and the footer says so in a few words.
- **Built from what worked.** The addition is written from the run's own steps that
  succeeded — the query that returned data, the command that exited clean. If the
  run never managed it, the fix is marked `untested` and goes to `proposals.md`.
- **A correction outranks a request.** When the user corrected the run, the request
  is held back and the fix is chosen as usual; otherwise the request is the run's
  fix. A held-back request stays in the notes and is picked up on its next sighting.
- A request after the footer is scored on its own: a new Scores row with reason
  `request`, not a replacement of the run's row, so it can be applied even when the
  run already had a fix.
- The fix is `logic`, its problem type `gap`, its key by the key rule (for example
  `skill.missing-step`). It is routed like any other fix: the skill's `SKILL.md` or
  `references/` (Q3, Q5), or the family folder when it is a fact the family shares.

## Text or logic

Every fix is labelled one of two kinds.

- **Text** changes the words, not what the skill does: a typo, clearer wording, a
  fact (a name, an id, a path), a better example.
- **Logic** changes what the skill does: a new step, a new or changed rule, a
  different query, a threshold, a scoring criterion.
- When unsure, it is **logic**.
- A change that adds, removes or alters a rule word (`must`, `never`, `always`,
  `only`, `do not`) or a number is always **logic** — except a pointer edit, below.
- A change inside a code block or a verbatim quote is always **logic**. Quoted
  examples are evidence; text fixes never rewrite them.
- **A pointer edit is text**, even when the replaced line holds a number. When a fact
  moves to the family folder, each exact copy of it in a member — the sentence or
  table row stating the same value — is replaced by `see <shared file> — <section>`
  (in a table row, only the cell that holds the value). It moves a fact; it changes
  no rule. Copies inside a code block or a quoted example are not pointer edits: they
  stay as they are.

## Where a fix goes

The skill's settings (`text_auto`, `logic_auto`) come from the data folder's
`config.json`: the skill's own entry first, else the defaults.

A skill whose `skill-coach:` frontmatter block has a `shared: <folder>` line belongs
to a family: the connected skills that name the same folder. That folder is the
family folder; it holds facts the members share.

| The fix is… | Goes to |
|---|---|
| text, inside the skill's own folder, `text_auto` on | applied |
| text, `text_auto` off | `proposals.md` |
| logic, inside the skill's own folder, `logic_auto` on | applied |
| logic, `logic_auto` off | `proposals.md` |
| a fact in the family folder | applied under the scored skill's `text_auto`; off → `proposals.md`, together with its pointer edits |
| a rule (logic) in the family folder | `proposals.md`, always — it changes every member at once |
| a pointer edit in a member of the same family | applied under that member's own `text_auto`; off → that edit goes to `proposals.md` and the rest of the change applies |
| a generated file (`.generated.` in its name) | never edited — a script rewrites it; the fact goes into the hand-written file next to it |
| an addition the run never managed (`untested`) | `proposals.md`, always, marked untested |
| the skill's own `references/rubric.md` | `proposals.md`, always — the judge never changes the rules it scores by |
| outside the skill's own folder (a `CLAUDE.md`, memory, another skill) | `proposals.md`, always — except the family folder and pointer edits inside the same family, above |
| a plugin file (this file, an agent) | `proposals.md`, always — changed in the plugin repo and released |
| a broken setup (missing permission, host down, bad credential) | reported only, no fix |

## Routing test

Decides where a lesson belongs. Ask in order; stop at the first yes.

```
Q1  Is something actually broken — bad config, missing permission, wrong
    credential, unreachable host?
    → Not a self-improvement matter. Report it and stop.
      A rule that documents a defect makes the defect permanent.

Q2  Is it about how the agent should behave, whatever the task?
    → a CLAUDE.md (user-wide, or the project's)        — always a proposal

Q3  Is it a fact — a name, id, URL, label, path?
    → used by exactly one skill                  → that skill's references/
    → used by several skills of one family       → the family's shared folder (a fact: auto under text_auto)
    → used by several skills, no common family   → memory   — always a proposal

Q4  Does it change what counts as a good result?
    → the skill's references/rubric.md, or this file   — always a proposal

Q5  Otherwise — is it how to do this specific job?
    → the skill's SKILL.md
```

Q1 is the one most often skipped and the most expensive to skip: an outage dressed
up as a skill defect produces a rule that encodes the outage forever.

## Growing the criteria

The measuring rules improve too, always by proposal, never automatically.

- **Undo counts as a rejection** of the fix it reverted. An undo followed by the
  user's own different change to the same section counts as an **edit**; record the
  difference between the proposed and the applied text.
- A criterion **rejected 3 times** → propose removing it. Repeated rejection means
  the criterion is wrong, not the skill.
- A criterion **edited 3 times** → propose rewording its suggested action, not
  removing it. An edit confirms the finding and corrects the fix.
- A criterion **not fired in 30 days** → a removal candidate. Propose, never delete.
- The **same problem in 2 or more different skills** → propose adding it here and
  removing the per-skill copies. Seen in one skill only → it belongs in that skill's
  rubric.
- A new criterion is proposed only for a real defect that no existing criterion
  names. It states its key, its family, its weight with a one-line reason, and a real
  example from the run — never a hypothetical. One at a time; never a near-duplicate
  of an existing key.
