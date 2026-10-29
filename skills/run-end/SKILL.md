---
name: run-end
description: >
  Invoke at the end of every run of a skill connected to skill-coach (its SKILL.md
  says so), and again when the user's next message corrects that run or asks to add
  something to the skill. Decides whether the run is worth scoring, asks the one-time
  logic question, then calls the skill-coach judge and worker and prints their
  one-line footer.
---

# run-end

Follow these steps in order. Most runs stop at step 3, which costs nothing.

## 1. Paths

- `plugin_root` = this skill's base directory, two levels up (`<base>/../..`).
- `data_dir` = `~/.claude/self-improvement` (expand `~`).
- `skill` = the connected skill that just ran. `skill_dir` = its folder.
- `rubric_path` = `skill_dir` joined with the `rubric:` value under the skill's
  `skill-coach:` frontmatter block.
- `hand_over` = the lines of the skill's `## Self-improvement` section after the line
  ending `not here.` (may be empty).

## 2. Find the run

When the skill started, the hook added a note: *"skill-coach: run `<n>` of `<skill>`
recorded (session `<id>`[, agent `<id>`])"*. Take `session_id` — and the agent id, if
the note names one — from the latest such note for this skill.

Then Grep `<data_dir>/ledger.jsonl` for lines that contain `"skill":"<skill>"` and
`"session":"<session_id>"` — plus `"agent":"<agent id>"` when the note named one, or
no `"agent"` at all when it did not — and take the **last** match. Its `transcript`
is `transcript_path`. Never use a line from another session.

No note or no match → print one line, *"skill-coach: no ledger entry for `<skill>` in
this session — is the plugin's hook installed?"*, and stop.

## 3. Trouble test

Decide from what you saw in this run; no tool call needed. Score the run only if one
of these happened:

- an error the skill could have caused — errors raised by Claude Code itself (a hook
  block, "File has not been read yet", an input validation error) do **not** count;
- the user corrected the result or rejected a tool call, including in their next
  message;
- more than 20 tool calls were used;
- part of what the user asked — the prompt that started the run included — had no
  step in the skill and was improvised, or the user's next message asks to add
  something to the skill;
- the note *"skill-coach: cost check due for `<skill>`"* is there (the hook adds it as
  run-end starts) — keep its text as `cost_note`;
- a note *"skill-coach: spot check due for `<skill>`"* appeared during this run;
- this call comes from `/skill-coach:analyze`.

Set `reason` to `analyze`, `correction`, `trouble` (an error, or more than 20 tool
calls), `request`, `cost` or `spot-check` accordingly; when several apply, take the
first in that order. `cost_note` is kept whatever the reason, and is `null` when there
was no such note.

Then skip, printing nothing, when:

- `score_after_run` is `off` for the skill in `<data_dir>/config.json` (its own entry
  first, else `defaults`; missing means `on`) — unless `reason` is `analyze`; or
- the skill was already scored automatically in this session: its notes file
  `<data_dir>/notes/<skill>.md` has a Scores row whose session column equals the
  first 8 characters of `session_id`. There are two exceptions: a `correction`
  re-run of the same run replaces that scoring rather than adding a second one, and a
  `request` run is never skipped — it adds a new Scores row of its own.

## 4. First time for this skill

If `config.json` has no entry for the skill under `skills`, write one now with the
Write or Edit tool: `"<skill>": { "logic_auto": "on" }`. Create the file with
`{"defaults":{"text_auto":"on","logic_auto":"on","score_after_run":"on"},"skills":{}}`
first if it does not exist.

Add this line under the footer in step 7: *"Auto-improvement of logic is on for
`<skill>`. Turn it off?"* Never wait for the answer — no answer means `on`. If the
user later says to turn it off, Edit the entry to `"logic_auto": "off"`.

## 5. Judge

Call the subagent `skill-coach:judge` in the foreground. Pass, as a list:
`plugin_root`, `data_dir`, `skill`, `skill_dir`, `rubric_path`, `transcript_path`,
`session_id`, `reason`, `cost_note` (or `null`), `hand_over`.

Take the last fenced `json` block of its answer as `decision`.

If you think the judge is wrong that something was shown, check before you dispute it:
run `node <plugin_root>/scripts/read-run.js --transcript <transcript_path> --skill <skill>`.
Its `final_answer` holds every text block of the run, text written before a tool call
included; thinking never reaches the user. Your memory of what you printed is not
evidence, and a disputed decision still goes to the worker unless that output shows
the judge missed the text.

## 6. Worker

Call the subagent `skill-coach:worker` in the foreground. Pass `plugin_root`,
`data_dir`, `skill`, `skill_dir`, `rubric_path`, `session_id` and `decision`. On a
`correction` re-run, also pass `replaces`: the fix id in this session's Scores row for
the skill (`none` when that row has none). A `request` run never passes `replaces`.

## 7. Footer

Print the worker's one-line footer exactly as returned, then the first-time line from
step 4 if there is one. Never invent or round a number.

## 8. A correction or a request after the footer

If the user's next message corrects this run, invoke run-end again for the same run
with `reason: correction`. If it asks to add something to the skill ("add this to the
skill", "do this every time"), invoke run-end again for the same run with
`reason: request`.
