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

Nothing in the skill's `SKILL.md` changes until step 5, and only after the user says
yes. The rubric (step 2) and the config entry (step 3) are written earlier, and undo
leaves them in place.

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
of logic is on for `<skill>`. Turn it off?"* — and wait for the answer; an unclear
answer means `on`. Add the key `"logic_auto": "on" | "off"` to the skill's entry under
`skills` with the Edit tool, keeping any other keys that entry already has.
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
end, or is `keep` (it already matches, so only the frontmatter changes). Ask one question: *"Connect `<skill>` with these two changes?"*
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

- Never write a skill file except through the two planned edits.
- Never connect a plugin's skill; the planner refuses them.
- Never invent a rubric: either the user approves the rubric-builder's draft, or the
  skill already has one.
