---
name: undo
description: >
  Undo a change skill-coach applied to a skill, restoring the file from its backup.
  Use when the user runs /skill-coach:undo, or asks to revert or roll back the last
  automatic change to a skill.
argument-hint: "[change-id]"
---

# undo

- `data_dir` = `~/.claude/self-improvement` (expand `~`).
- The change: the id given as the argument, else the newest entry in
  `<data_dir>/changes.md` whose status is `done`.

## Steps

1. Show the entry in two lines: the file and the change's before → after.
2. **Check before touching anything.** Read the file. It must contain the entry's
   `after` text exactly once. If it does not — the file changed since, or the text
   appears more than once — restore nothing. Say so, and name the safety copy (the
   entry's `- backup:` line) so the user can restore by hand.
3. Edit the file: replace the `after` text with the `before` text. Never write a
   whole file back — edits made since elsewhere in the file must stay.
4. Edit the entry's header status from `done` to `undone` and add
   `- undone: <today> (by the user)`.
5. In `<data_dir>/notes/<skill>.md`, Edit the key's entry: `- status:` becomes
   `rejected-by-undo`, and add the line `- rejected-by-undo: <today> (<change id>)`.
   That line is what counts this undo as a rejection of the fix.
6. Say in one line what was reverted: *"Reverted `<change id>` in `<file>`."*
