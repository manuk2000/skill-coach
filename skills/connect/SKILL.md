---
name: connect
description: >
  Connect one of the user's own skills to skill-coach in one guided pass: write its
  rules file (references/rubric.md) with the rubric-builder, asking the user only
  what it cannot decide, one question at a time in plain words, ask the one-time
  logic question, show the
  two exact edits to its SKILL.md, apply them on a yes, log them so
  /skill-coach:undo can reverse the connect, and confirm. Use when the user runs
  /skill-coach:connect, or asks to connect, hook up or wire a skill to skill-coach.
  Without a skill name it lists the user's unconnected skills, most used first.
argument-hint: "[skill] [--root user|project]"
---

# connect

- `plugin_root` = this skill's base directory, two levels up.
- `data_dir` = `~/.claude/self-improvement` (expand `~`).
- `plan` = `node <plugin_root>/scripts/connect-plan.js` — read-only; it prints JSON.

Nothing in the skill's `SKILL.md` changes until step 5, and only after the user says
yes. The rubric (step 2) and the config entry (step 3) are written earlier, and undo
leaves them in place.

## How to ask

Every question in this skill — picking the skill, the rubric-builder's questions,
saving the rules, the auto-fix setting, the final yes — is asked the same way:

- **Only real choices.** Ask only what you cannot decide yourself: a preference that
  only the user has, or a yes before something is written. What the skill's own
  text, a default or an earlier answer settles is decided and shown, never asked.
- With the AskUserQuestion tool, **one question per call**. Wait for the answer
  before the next question. Never put two questions in one call or one message.
- In plain words: one short sentence, no rubric or plugin terms (unit, must-not,
  rubric, logic, hook), and an example when it helps.
- The suggested answer is the first option, its label ending in `(Recommended)`.
  Every option gets a one-line description of what choosing it does. A header has at
  most 12 characters.
- When the tool is not available, ask the same question as plain text, one per
  message, and stop until the user answers.

## 0. No skill named

Run `<plan> --list --cwd <the current folder>`. Show the unconnected skills as a short
table — skill, where it lives, runs recorded — most used first. Then ask *"Which skill
should I connect?"* with the four most used as options (the user can type any other
name). Stop here until the user picks.

## 1. Find and check

Run `<plan> --skill <name> --cwd <the current folder>` (add `--root user|project` if
the user gave one).

- `ok: false` → say the `reason` in one line and stop.
- `state: "connected"` → say it is already connected, whether its rubric exists, and stop.
- `warning` present → say it once (a project skill's change shows in git).

## 2. Rules first

The skill's `SKILL.md` must never point at a rules file that does not exist.

- `rubric.exists` is true → keep it. The useful lines of the current
  `## Self-improvement` section (`existingSection`) become the hand-over line, as
  `Hand over: <them>`, or `Hand over: —` when there are none; the preview shows it.
- `rubric.exists` is false:
  1. Call the subagent `skill-coach:rubric-builder` with `skill_dir` (the folder of
     `file`) and `plugin_root`.
  2. `## Questions` is `none` → go to 5. Otherwise say in one line: *"I set most of
     the rules from `<skill>` itself. <n> question(s) only you can answer, one at a
     time."*
  3. Ask its `## Questions` in order, one per call: the question is `ask` followed by
     `For example: <example>`; the header is the text after `Q<n> · `; the options
     are `suggested` (label + `(Recommended)`, its meaning as the description) and
     each `other`. Do not show the draft yet.
  4. Every answer was the suggested one → keep the draft. Any other answer → call the
     rubric-builder again with `answers`: each question's `ask` with the user's
     answer in their words. Ask any new question it returns the same way.
  5. Show its `## Decided for you` first, under the heading *"Decided from your
     skill — type a change if one is wrong"*; then the draft; then its
     `## Problems in the skill` under the heading *"Not part of the rules — problems
     in the skill itself"* (leave it out when it says none).
     Ask *"Save these rules for `<skill>`?"* — `Save them (Recommended)`: writes
     `references/rubric.md`, the skill itself is not changed yet; `Stop here`:
     nothing is written. A typed answer is a change: call the rubric-builder again
     with it, show the new draft, and ask again.
  6. Saved → Write the draft to `rubric.path`. Stopped → stop; nothing has been
     changed.

The hand-over line is the rubric-builder's `Hand over:` line as it is. Only when it
asked the evidence question: `Nothing extra` → `Hand over: —`; a typed answer →
`Hand over: <the user's words>`.

## 3. The one question

If `<data_dir>/config.json` has no `logic_auto` for this skill, ask: *"Small wording
fixes are always made by themselves. When a run of `<skill>` goes wrong, may
skill-coach also change the skill's steps and rules by itself?"* — header `Auto-fix`;
options `Yes, by itself (Recommended)`: the fix is made and logged,
`/skill-coach:undo` reverses it → `on`; `No, ask me first`: the fix waits until you
approve it in `/skill-coach:analyze` → `off`. An unclear answer means `on`. Add the
key `"logic_auto": "on" | "off"` to the skill's entry under `skills` with the Edit
tool, keeping any other keys that entry already has.
Create the file as
`{"defaults":{"text_auto":"on","logic_auto":"on","score_after_run":"on"},"skills":{}}`
first if it does not exist.

## 4. Preview

Write the agreed hand-over line to `<data_dir>/tmp/hand-over.txt` with the Write tool,
then run `<plan>` again with the same `--cwd`/`--root` plus
`--hand-over-file <data_dir>/tmp/hand-over.txt`. Never pass the line as a shell
argument — backticks and `$` in it would be expanded. Show every edit in `edits`
exactly as before → after: first the frontmatter, then the `## Self-improvement`
section. `sectionMode` says whether the section replaces an old one, is added at the
end, or is `keep` (it already matches, so only the frontmatter changes). Then ask
*"Make these <2 or 1> changes to `<skill>`'s SKILL.md?"* — header `Connect`; options
`Yes, connect it (Recommended)`: applies the changes shown above, `/skill-coach:undo`
reverses them; `No, stop here`: the skill stays as it is and the saved rules stay.
No yes → stop.

## 5. Apply

1. Append one entry to `<data_dir>/changes.md` in the worker's format (see
   `<plugin_root>/agents/worker.md`, Formats), with status `started`, kind `connect`,
   and each edit as a numbered pair (`before 1:`/`after 1:`, `before 2:`/`after 2:` —
   one pair when `sectionMode` is `keep`). Create the file with its title and anchor
   first if it does not exist.
2. Read `file` with the Read tool now — the Edit tool needs it, and it catches a file
   that changed since the preview.
3. Apply the edits in order with the Edit tool, using `old_string` and `new_string`
   exactly as printed — never retype or reflow them.
4. All succeeded → set the entry to `done`. One failed → Edit any applied pair back
   (`after` → `before`), set the entry to `undone` with `- failed: <why>`, and stop.

## 6. Confirm

Run `<plan>` once more with the same `--cwd` and `--root`. Both `state: "connected"`
and `hookConnected: true` are required. If either is missing, say the skill did not
connect and point to `/skill-coach:undo <change id>`. Otherwise say in one line: *"Connected `<skill>`. Every run is recorded; a run with trouble is scored.
Undo with `/skill-coach:undo <change id>`."*

## Rules

- One question at a time, as in "How to ask" — never a list of questions in one
  message.
- Never write a skill file except through the two planned edits.
- Never connect a plugin's skill; the planner refuses them.
- Never invent a rubric: either the user approves the rubric-builder's draft, or the
  skill already has one.
