# skill-coach

A Claude Code plugin that helps your own skills get better through use.

It records every skill run, scores the runs that had trouble, and improves the skill
for you: **text fixes are applied automatically, logic fixes too unless you turn that
off for a skill.** Every change is logged with its before and after text and can be undone with one
command. Its records stay in a private folder on your machine; the only thing sent
anywhere is what Claude reads during your normal session.

## What happens in one run

You run `demo-skill`, and in your next message you correct its answer.

1. **A hook records the run** — one line in a private ledger, no AI involved.
2. **At the end of the run, skill-coach checks for trouble** — an error the skill
   caused, a correction or a rejected tool call from you, an unusually long run, or a
   1-in-10 spot check. A clean run stops here and costs nothing.
3. **The first time a skill is scored**, you see one line: *"Auto-improvement of logic
   is on for `demo-skill`. Turn it off?"* No answer means it stays on.
4. **The judge (Opus) scores the run** against the general criteria and the skill's
   own rubric, checks whether the problem happened before, and picks at most one fix.
5. **The worker (Sonnet) carries it out**: it backs up the file, applies the fix (or
   files it as a proposal when your settings say so), logs the change, and updates
   the skill's notes.
6. **You see one line**: `🟡 6/10 · Changed SKILL.md → «…» · Undo: /skill-coach:undo`.

Later, `/skill-coach:analyze` shows what changed, how often each skill had trouble,
which problems keep coming back, and the fixes waiting for your decision.

## Install

```
/plugin marketplace add manuk2000/skill-coach
/plugin install skill-coach@skill-coach
```

Start a new session afterwards; hooks load at session start. The plugin needs Node.js
(any version Claude Code itself runs on); it uses no packages.

## Connect a skill

A skill is recorded as soon as the plugin is installed, but scored only once you
connect it. One command does it:

```
/skill-coach:connect demo-skill
```

It asks you a few short questions, one at a time, each with a suggested answer you can
take with one click. From your answers the `skill-coach:rubric-builder` agent drafts
the skill's rules file, and you approve it. Then it asks whether skill-coach may change
the skill's steps by itself, shows the two exact changes to `SKILL.md`, applies them on
your yes, and confirms. `/skill-coach:undo` reverses it.
Run `/skill-coach:connect` without a name to list your unconnected skills, most used
first. Skills that belong to a plugin cannot be connected.

### By hand

Add two things to the skill's `SKILL.md`:

1. In the frontmatter:

   ```yaml
   skill-coach:
     rubric: references/rubric.md
   ```

2. A short section:

   ```markdown
   ## Self-improvement

   At the end of every run — and again if the user's next message corrects the
   result — invoke `skill-coach:run-end`. Settings live in the skill-coach data
   folder, not here.
   ```

   You may list, under that sentence, the evidence the judge should look at for this
   skill (for example a self-check the skill prints).

Then write `references/rubric.md` — the rules the skill is scored by. The
`skill-coach:rubric-builder` agent drafts one for you: ask Claude to *"use the
skill-coach rubric-builder agent for demo-skill"*. It returns a few questions, each
with a suggested answer, and a draft built from them; you save it.

## Settings

In `~/.claude/self-improvement/config.json`. Each setting has a default for all skills,
and any skill can override it:

| Setting | Controls | Options | Default |
|---|---|---|---|
| `text_auto` | text fixes (typos, wording, facts) applied automatically | `on` / `off` | `on` |
| `logic_auto` | logic fixes (a new step, rule, query, threshold) applied automatically | `on` / `off` | `on` — asked once per skill |
| `score_after_run` | score a run that had trouble, at its end | `on` / `off` | `on` |

```json
{
  "defaults": { "text_auto": "on", "logic_auto": "on", "score_after_run": "on" },
  "skills": {
    "demo-skill": { "logic_auto": "off" }
  }
}
```

Some fixes never apply automatically, whatever the settings: changes to a skill's
`rubric.md`, to anything outside the skill's own folder (a `CLAUDE.md`, memory,
another skill), and to the plugin's own files. They wait in `proposals.md`.

Commands:

| Command | Arguments | Default |
|---|---|---|
| `/skill-coach:analyze` | `[skill] [session \| 7d \| 30d \| all]` | all skills, `session` |
| `/skill-coach:undo` | `[change-id]` | the last change |
| `/skill-coach:connect` | `[skill] [--root user \| project]` | no name: list unconnected skills |

## Data folder

`~/.claude/self-improvement/` — private, never shared, never part of this repo.

| File | Holds |
|---|---|
| `config.json` | your settings |
| `ledger.jsonl` | one line per skill run |
| `changes.md` | every applied change, with before → after |
| `proposals.md` | fixes waiting for your decision |
| `backups/` | a copy of each file before it was changed |
| `notes/<skill>.md` | the problems seen per skill, with counts, and a score table |

## Permissions

The plugin never edits your settings. For changes to happen without a prompt, allow
edits to your skills folder and the data folder, for example in your user
`settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Edit(~/.claude/skills/**)",
      "Write(~/.claude/self-improvement/**)",
      "Edit(~/.claude/self-improvement/**)"
    ]
  }
}
```

Without these you get a permission prompt per change. A change interrupted by a
denied write is rolled back at the next scoring — but only while the file still holds
that change; otherwise it is left alone and reported.

## How it decides

- **Scoring** starts at 10 and deducts; one bad step is never averaged away.
  Errors raised by Claude Code itself (a hook block, a read-before-write guard) never
  count against a skill.
- **One fix per run**, chosen by the largest deduction.
- **Text or logic**: anything that changes what a skill does — or touches a rule word,
  a number, a code block or a quote — counts as logic. When unsure, logic.
- **A lesson from a single run** is only written down when the run proves it: a
  passing check, a named failure, and an approach tried and ruled out.
- **Broken setup** (a missing permission, a host that is down) is reported, never
  "fixed" by writing a rule.

Full rules: [`criteria/general.md`](criteria/general.md).

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
