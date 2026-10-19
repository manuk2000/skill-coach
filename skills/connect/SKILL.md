---
name: connect
description: >
  Connect one of the user's own skills to skill-coach in one guided pass: write its
  rules file (references/rubric.md) with the rubric-builder, ask the one-time logic
  question, show the two exact edits to its SKILL.md, apply them on a yes, log them so
  /skill-coach:undo can reverse the connect, and confirm. Use when the user runs
  /skill-coach:connect, or asks to connect, hook up or wire a skill to skill-coach.
  Without a skill name it lists the user's unconnected skills, most used first.
argument-hint: "[skill] [--root user|project]"
---

# connect

- `plugin_root` = this skill's base directory, two levels up.
- `data_dir` = `~/.claude/self-improvement` (expand `~`).
- `plan` = `node <plugin_root>/scripts/connect-plan.js` — read-only; it prints JSON.

Nothing in the user's skill changes until step 5, and only after the user says yes.

## 0. No skill named

Run `<plan> --list --cwd <the current folder>`. Show the unconnected skills as a short
table — skill, where it lives, runs recorded — most used first, and ask which one to
connect. Stop here until the user picks.

## 1. Find and check

Run `<plan> --skill <name> --cwd <the current folder>` (add `--root user|project` if
the user gave one).

- `ok: false` → say the `reason` in one line and stop.
- `state: "connected"` → say it is already connected, whether its rubric exists, and stop.
- `warning` present → say it once (a project skill's change shows in git).

## 2. Rules first

The skill's `SKILL.md` must never point at a rules file that does not exist.

- `rubric.exists` is true → keep it. Read the skill's current `## Self-improvement`
  section (`existingSection`, if any) and offer its useful lines as the hand-over
  line; the user confirms or edits.
- `rubric.exists` is false → call the subagent `skill-coach:rubric-builder` with
  `skill_dir` (the folder of `file`) and `plugin_root`. Show the user its draft, its
  questions with their suggested answers, and its suggested hand-over line. Wait for
  the user. If they correct something, call the rubric-builder again with their
  `answers`. When they approve, Write the draft to `rubric.path`. If they stop here,
  stop — nothing has been changed.

## 3. The one question

If `<data_dir>/config.json` has no `logic_auto` for this skill, ask: *"Auto-improvement
of logic is on for `<skill>`. Turn it off?"* — and wait for the answer. Save it as
`"<skill>": { "logic_auto": "on" | "off" }` under `skills`, with the Write or Edit tool.
Create the file as
`{"defaults":{"text_auto":"on","logic_auto":"on","score_after_run":"on"},"skills":{}}`
first if it does not exist.

## 4. Preview

Run `<plan>` again with `--hand-over "<the agreed hand-over line>"`. Show both edits
from `edits` exactly as before → after: first the frontmatter, then the
`## Self-improvement` section (`sectionMode` says whether it replaces an old section or
is added at the end). Ask one question: *"Connect `<skill>` with these two changes?"*
No yes → stop.

## 5. Apply

1. Append one entry to `<data_dir>/changes.md` in the worker's format (see
   `<plugin_root>/agents/worker.md`, Formats), with status `started`, kind `connect`,
   and both edits as numbered pairs `before 1:`/`after 1:` and `before 2:`/`after 2:`.
   Create the file with its title and anchor first if it does not exist.
2. Apply `edits[0]`, then `edits[1]`, with the Edit tool, using `old_string` and
   `new_string` exactly as printed — never retype or reflow them.
3. Both succeeded → set the entry to `done`. One failed → Edit any applied pair back
   (`after` → `before`), set the entry to `undone` with `- failed: <why>`, and stop.

## 6. Confirm

Run `<plan> --skill <name>` once more. `state` must now be `connected`. Then say in
one line: *"Connected `<skill>`. Every run is recorded; a run with trouble is scored.
Undo with `/skill-coach:undo <change id>`."*

## Rules

- Never write a skill file except through the two planned edits.
- Never connect a plugin's skill; the planner refuses them.
- Never invent a rubric: either the user approves the rubric-builder's draft, or the
  skill already has one.
