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
2. **Check before touching anything.**
   - The backup named in the entry's `- backup:` line must exist under `data_dir`.
   - The file must still contain the entry's `after` text exactly. If it does not,
     someone changed the file since; restoring the backup would throw that work
     away.
   - If either check fails, restore nothing. Say which check failed and where the
     backup is, so the user can restore by hand.
3. Read the backup and Write its content over the file.
4. Edit the entry's header status from `done` to `undone` and add
   `- undone: <today>`.
5. In `<data_dir>/notes/<skill>.md`, Edit the key's entry so `- status:` reads
   `rejected-by-undo`. The undo counts as a rejection of that fix.
6. Say in one line what was restored: *"Restored `<file>` from `<change id>`."*
