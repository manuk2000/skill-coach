# skill-coach

A Claude Code plugin that makes your own skills better while you use them.

It records every skill run, scores the runs that had trouble, and fixes the skill for
you: **wording fixes are applied automatically, step and rule fixes too unless you
turn that off for a skill.** Every change is logged with its before and after text
and can be undone with one command. Its records stay in a private folder on your
machine; the only thing sent anywhere is what Claude reads during your normal session.

After a run that went wrong, you see one line:

```
🟡 6/10 · Changed SKILL.md → «Group the changes under the headings the…» · Undo: /skill-coach:undo
```

A clean run prints nothing and costs almost nothing.

## Quick start

1. **Install**, then start a new session (hooks load at session start). The plugin
   needs Node.js and no packages.

   ```
   /plugin marketplace add manuk2000/skill-coach
   /plugin install skill-coach@skill-coach
   ```

2. **Connect one of your skills.** You normally answer two cards: save the rules it
   drafted from your skill, and confirm the two changes to the skill's `SKILL.md`.
   Auto-fix is on from the start; `/skill-coach:undo` reverses any change.

   ```
   /skill-coach:connect release-notes
   ```

3. **Use the skill as usual.** When a run has trouble (you correct it, it hits an
   error, it runs long, or it's every 10th run as a spot check), you get the score
   line. `/skill-coach:undo` reverts any change.

## User guide

The [user guide](docs/guide.md) explains the rest in plain words:

- [One run, step by step](docs/guide.md#one-run-step-by-step)
- [Connect a skill](docs/guide.md#connect-a-skill), by command or by hand
- [When a run gets scored](docs/guide.md#when-a-run-gets-scored)
- [Read the score line](docs/guide.md#read-the-score-line)
- [What it may change by itself](docs/guide.md#what-it-may-change-by-itself)
- [Commands](docs/guide.md#commands), [Settings](docs/guide.md#settings),
  [Permissions](docs/guide.md#permissions) and [Your data](docs/guide.md#your-data)
- [Questions](docs/guide.md#questions)

The full scoring rules are in [`criteria/general.md`](criteria/general.md).

## Development

```
node --test 'tests/**/*.test.js'
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin validate --strict agents
claude plugin validate --strict skills
```

## Credits

Ideas, not code, from these projects: the transcript-reading lessons of
[claude-reflect](https://github.com/BayramAnnakov/claude-reflect) (MIT), the
"ignore evidence older than the last edit" rule from
[Dust](https://github.com/dust-tt/dust) (MIT), and the "unscored is neutral" rule
from [Cognee](https://github.com/topoteretes/cognee) (Apache-2.0).

## Licence

MIT — see [LICENSE](LICENSE).
