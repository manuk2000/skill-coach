---
name: undo
description: >
  Undo a change skill-coach applied to a skill, or to a skill family's files,
  restoring the text it replaced.
  Use when the user runs /skill-coach:undo, or asks to revert or roll back the last
  automatic change to a skill.
argument-hint: "[change-id]"
---

# undo

- `data_dir` = `~/.claude/self-improvement` (expand `~`).
- The change: the id given as the argument, else the newest entry in
  `<data_dir>/changes.md` whose status is `done`.

## Steps

1. Show the entry in two lines: the file and the change's before → after. A `family`
   entry gets one line per pair, naming its file.
2. **Check before touching anything.** An entry may hold numbered pairs
   (`before 1:`/`after 1:`, `before 2:`/`after 2:` — a `connect` entry holds two, all
   in its one `- file:`). Pairs may also name their own file (`- file N:` — a `family`
   entry does): pair N is in the file on its `- file N:` line. Check every pair in
   every file before reverting any, then revert them last pair first. Read each file.
   It must contain each `after` text exactly once. If it does not — a file changed
   since, or the text appears more than once — restore nothing. Say so, and name the
   safety copy (the entry's `- backup:` line — for a `family` entry a folder with one
   copy per edited file; a `connect` entry has none, so show its `before` texts) so
   the user can restore by hand.
3. Edit each file: replace the `after` text with the `before` text. Never write a
   whole file back — edits made since elsewhere in the file must stay. A
   `before N: (new file)` pair is not checked in step 2 and never deleted. Once the
   other pairs are reverted, if that file still holds exactly its `after` text, say
   *"`<path>` was created by this change and is now unused; to remove it run:
   `rm "<path>"`"*. If it holds anything else, say it was created by this change and
   has changed since, so it stays.
4. Edit the entry's header status from `done` to `undone` and add
   `- undone: <today> (by the user)`.
5. Skip this step for a `connect` entry — it has no key. Otherwise (a `family` entry
   has one too), in `<data_dir>/notes/<skill>.md`, Edit the key's entry: `- status:`
   becomes `rejected-by-undo`, and add the line
   `- rejected-by-undo: <today> (<change id>)`. That line is what counts this undo as
   a rejection of the fix.
6. Say in one line what was reverted: *"Reverted `<change id>` in `<file>`."* — for a
   `family` entry, name every file.
