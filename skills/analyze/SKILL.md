---
name: analyze
description: >
  Look back at skill-coach's records: what changed since last time, fixes waiting for
  approval, how often each skill had trouble, and problems that keep coming back.
  With the period "session" it also scores this session's unscored runs. Use when the
  user runs /skill-coach:analyze or asks how their skills have been doing or what
  should be improved.
argument-hint: "[skill] [session|7d|30d|all]"
---

# analyze

Arguments: an optional skill name, then a period — `session` (default), `7d`, `30d`
or `all`. Without a skill name, cover every skill.

- `plugin_root` = this skill's base directory, two levels up.
- `data_dir` = `~/.claude/self-improvement` (expand `~`).
- **This session**: the last line of `<data_dir>/ledger.jsonl` whose skill is
  `skill-coach:analyze` — the hook logged it a moment ago — gives `session_id` and
  `transcript_path`.

Every count you show carries the total it is out of ("3 of 41 runs"). Never show a
bare number.

## 1. Changed since last time

List the entries in `<data_dir>/changes.md` dated on or after `last_analyze` in
`config.json` (all of them when it is missing): id, skill, file, kind (text, logic,
connect or family), status, why. Then Edit `config.json` to set `"last_analyze": "<now, ISO-8601>"`.

## 2. Waiting fixes

List the `pending` entries in `<data_dir>/proposals.md` (for the named skill only,
when one is given), each with its before → after (one per pair, naming its file, when
it has `- file N:` lines), why and evidence. Say when one is marked
`- untested: yes` — the run never managed what it adds. Ask the user to approve or
reject each, in one message, and wait for the answer.

- **Approve** → call the subagent `skill-coach:worker` with `plugin_root`,
  `data_dir`, the proposal's skill with its `skill_dir` and `rubric_path`,
  `session_id`, `decision: null` and `approved: <proposal id>`. Print its footer.
- **Reject** → Edit the proposal's status to `rejected`, add
  `- reason: <the user's words>`, and set the key's status in the notes back to
  `open`.

## 3. Rates per skill and family

For the period, per skill: runs (`run` lines in `ledger.jsonl`), scored runs (rows in
the notes' Scores table), changes applied (`done` in `changes.md`, not counting kind
`connect`), changes undone
(`undone`), proposals waiting. A table, with denominators.

Then group the skills by family. Run `node <plugin_root>/scripts/family.js --skill <skill>`
once per skill seen in the period; a skill already listed among another's `members`
needs no run of its own. For each family (`shared` not `null`), show next to the
per-skill table: the family folder; its members that ran, out of all members; runs
and scored runs, summed over the members; `family` changes applied and undone; and
the repeated keys — problem keys in the notes of two or more members, each with the
members it was seen in ("in 2 of 3 members").

Count **rejections** from the `- rejected-by-undo:` lines in the notes — only the undo
skill writes them, so a recovered or failed change is never counted as a rejection.
For each change the user undid (not kind `connect`), read the same section of the file now (for a
`family` change, the family file — its pair 1). If the user
has since changed it themselves, that is an **edit**: add
`- edited: <today> (<change id>): <one line on what the user wrote instead>` under the
key in the notes (once per change), and show the difference.

## 4. Repeats

List the problem keys whose `count` is 3 or more, with skill, count, last seen and
status. Then check the counting rules in `<plugin_root>/criteria/general.md`
("Growing the criteria"). For a rubric criterion rejected 3 times, edited 3 times, or
not fired in 30 days, write the matching proposal to `proposals.md` in the worker's
format — never change a rubric or the criteria yourself.

## 5. Skills that are not connected

From the ledger: skills that ran in the period but have no `skill-coach:` block in
their frontmatter. Show how many runs each had — they are recorded, never scored —
and suggest `/skill-coach:connect <skill>` for the most used ones.

## 6. Scoring this session (period `session` only)

For each connected skill with a `run` line in this session and no Scores row for
this session yet: invoke `skill-coach:run-end` for it with `reason: analyze`. Other
periods only report and call no agent.
