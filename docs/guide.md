# skill-coach user guide

skill-coach makes your own skills better while you use them. It watches every run,
scores the runs that had trouble, and fixes the skill for you. Every change is logged
with its before and after text, and one command undoes it.

- [One run, step by step](#one-run-step-by-step)
- [Install](#install)
- [Connect a skill](#connect-a-skill)
- [When a run gets scored](#when-a-run-gets-scored)
- [Read the score line](#read-the-score-line)
- [What it may change by itself](#what-it-may-change-by-itself)
- [Commands](#commands)
- [Settings](#settings)
- [Permissions](#permissions)
- [Your data](#your-data)
- [Questions](#questions)

## One run, step by step

You have a skill called `release-notes` that writes the notes for a new version of
your app, and you have connected it to skill-coach.

1. **You** ask: *"write the release notes for version 2.4."* The skill answers with a
   list of the changes.
2. **The hook** writes one line to a private log: *run 1 of release-notes*. No AI is
   involved, so it costs nothing.
3. **skill-coach** checks for trouble at the end of the run: an error, a correction,
   an unusually long run, or a spot check. This run had none, so it stops here and
   prints nothing. No agents run.
4. **You** reply: *"No, group them under Added, Changed and Fixed, like the earlier
   releases."* That is a correction, so the run is now worth scoring.
5. **The judge (Opus)** reads the run and scores it. Every score starts at 10 and
   loses points per problem: −3 because you had to correct it, −1 for a smaller slip,
   so **6/10**. It picks at most one fix: *"group the changes under the headings the
   earlier release notes use"*. That's a new rule, so it's a **logic** fix.
6. **The worker (Sonnet)** carries it out. Logic fixes are allowed to apply by
   themselves for this skill, so it saves a backup of `SKILL.md`, changes that one
   section, and logs the change with its before and after text.
7. **You see** one line:

   ```
   🟡 6/10 · Changed SKILL.md → «Group the changes under the headings the…» · Undo: /skill-coach:undo
   ```

8. **If you disagree**, type `/skill-coach:undo`. The change is reverted, and the
   undo counts as a rejection, so skill-coach learns that this kind of fix was wrong.

## Install

```
/plugin marketplace add manuk2000/skill-coach
/plugin install skill-coach@skill-coach
```

Start a new session afterwards, because hooks load when a session starts. You need
Node.js (any version Claude Code runs on); the plugin uses no packages.

To install from a local copy instead, run `/plugin marketplace add /path/to/skill-coach`,
then the same install line.

## Connect a skill

Every skill run is recorded as soon as the plugin is installed, but only a connected
skill gets scored. One command connects one skill:

```
/skill-coach:connect release-notes
```

It reads the skill and drafts its scoring rules from what the skill itself says. It
asks you only what it can't work out alone, usually nothing. You normally answer
three cards, one at a time:

| Card | Question | Shown above it | Options |
|---|---|---|---|
| 1 | Save these rules for release-notes? | What it decided from your skill, each with a reason, and the draft rules | **Save them** · Stop here |
| 2 | May skill-coach change the skill's steps and rules by itself? | Wording fixes are always automatic | **Yes, by itself** · No, ask me first |
| 3 | Make these 2 changes to SKILL.md? | Both changes, before and after | **Yes, connect it** · No, stop here |

The suggested option is shown in bold.

- Type a change on any card instead of picking an option, and it is taken into
  account.
- Run `/skill-coach:connect` without a name to see your unconnected skills, most used
  first.
- Skills that come from a plugin can't be connected; only your own skills can.
- It also lists problems it noticed in the skill itself (a dead link, two rules that
  contradict). It reports them and never fixes them.
- `/skill-coach:undo <change id>` disconnects the skill again. The id is in the
  confirmation line.

### Connect by hand

Add this to the skill's `SKILL.md` frontmatter:

```yaml
skill-coach:
  rubric: references/rubric.md
```

Add this section anywhere in the skill:

```markdown
## Self-improvement

At the end of every run — and again if the user's next message corrects the
result — invoke `skill-coach:run-end`. Settings live in the skill-coach data
folder, not here.
```

Under that sentence you can add a line starting `Hand over:` that names extra evidence
the judge should look at, such as a self-check the skill prints.

Then write `references/rubric.md`, the rules the skill is scored by. Ask Claude to
*"use the skill-coach rubric-builder agent for release-notes"*: it returns a draft,
what it decided for you, and only the questions it can't answer itself. You save it.

A skill connected by hand gets one question the first time it is scored:
*"Auto-improvement of logic is on for `release-notes`. Turn it off?"* No answer
means it stays on.

## When a run gets scored

Only when one of these happened. Otherwise the run is just recorded.

| What happened | Example |
|---|---|
| An error the skill caused | A command it ran failed. Errors from Claude Code itself (a blocked tool, "file not read yet") don't count. |
| You corrected it | Your next message fixes its answer, or you rejected one of its tool calls. |
| A long run | More than 20 tool calls. |
| A spot check | Every 10th run of a skill is scored even when nothing went wrong. |
| You asked | `/skill-coach:analyze` scores this session's unscored runs. |

A skill is scored at most once per session. If you correct a run that was already
scored, the new score replaces the old one, and any second fix waits for your
approval instead of being applied.

## Read the score line

Scores start at 10 and lose points for each problem. If a skill's answer has several
parts (one section per release, one message per commit), each part gets its own grade.
You see the average, but the lowest part decides whether to fix, so one bad section is
never hidden by nine good ones.

| Band | Score | Meaning |
|---|---|---|
| 🟢 | 8 – 10 | Fine. Usually nothing changes. |
| 🟡 | 5 – 7.9 | Something went wrong; usually one fix. |
| 🔴 | 0 – 4.9 | A wrong answer; one fix. |

The line takes one of these shapes:

| Line | What it means |
|---|---|
| `🟡 6/10 · Changed SKILL.md → «…» · Undo: /skill-coach:undo` | A fix was applied. The quote is the start of the new text. |
| `🟡 6/10 · 1 fix waiting (P-20261025-001)` | A fix needs your decision; see it in `/skill-coach:analyze`. |
| `🟢 9/10` | Scored, nothing to change. |
| `⚠️ …` | Something in your setup is broken (a missing permission, a server that is down). It's reported, never "fixed" with a rule. |
| `n/a · …` | The run never finished a piece of work, so it can't be scored. That is not a failure. |

## What it may change by itself

Every fix is either **text** (wording, a typo, a name or path) or **logic** (a new
step, a rule, a number, anything in a code block or a quote). When unsure, it counts
as logic.

| The fix is… | What happens |
|---|---|
| Text, in the skill's own folder | Applied (setting `text_auto`, on by default) |
| Logic, in the skill's own folder | Applied, or waits for you if you said "ask me first" (setting `logic_auto`) |
| The skill's scoring rules | Always waits for you. The judge never changes the rules it scores by. |
| Anything outside the skill's folder | Always waits for you: a `CLAUDE.md`, memory, another skill. |
| The plugin's own files | Always waits for you. |
| A broken setup | Only reported. |

- At most one change per run: the fix for the biggest problem.
- It never deletes content and never changes a safety or permission rule.
- It edits one section in place. It never appends a "lessons learned" list to the end
  of a skill.
- A lesson from a single run is written down only when the run proves it: a passing
  check, a named failure, and an approach tried and ruled out.

Fixes that wait for you are kept in `proposals.md`; approve or reject them in
`/skill-coach:analyze`. The full scoring rules are in
[`criteria/general.md`](../criteria/general.md).

## Commands

| Command | What it does |
|---|---|
| `/skill-coach:connect [skill] [--root user\|project]` | Connects one skill. Without a name, lists your unconnected skills. `--root` chooses between your user skills and the project's skills. |
| `/skill-coach:undo [change id]` | Reverts a change; the last one when no id is given. It reverts only that change's text. If the text was edited since, it refuses and shows you the backup instead. |
| `/skill-coach:analyze [skill] [period]` | What changed since last time, fixes waiting for your approval, how often each skill had trouble, problems that keep coming back, and busy skills that aren't connected yet. Period: `session` (default), `7d`, `30d` or `all`. |

## Settings

In `~/.claude/self-improvement/config.json`. Each setting has a default for all
skills, and any skill can override it.

| Setting | Controls | Default |
|---|---|---|
| `text_auto` | Wording fixes apply by themselves | `on` |
| `logic_auto` | Step and rule fixes apply by themselves | `on`, asked once per skill |
| `score_after_run` | Runs with trouble get scored at the end | `on` |

```json
{
  "defaults": { "text_auto": "on", "logic_auto": "on", "score_after_run": "on" },
  "skills": {
    "release-notes": { "logic_auto": "off" }
  }
}
```

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
denied write is rolled back at the next scoring, but only while the file still holds
that change; otherwise it is left alone and reported.

## Your data

Everything stays in `~/.claude/self-improvement/` on your machine. Nothing is sent
anywhere beyond what Claude reads during your normal session.

| File | Holds |
|---|---|
| `config.json` | Your settings |
| `ledger.jsonl` | One line per skill run |
| `changes.md` | Every applied change, with before → after |
| `proposals.md` | Fixes waiting for your decision |
| `backups/` | A copy of each file before it was changed |
| `notes/<skill>.md` | Problems seen per skill, with counts, and a table of scores |

## Questions

**What does it cost?**
A clean run costs almost nothing: one log line and a quick check. Only a run with
trouble starts the judge (Opus) and the worker (Sonnet). Models are chosen by name
family, so newer versions are used automatically.

**Is a skill I didn't connect tracked?**
Its runs are counted, never scored. `/skill-coach:analyze` shows busy skills that
aren't connected yet.

**How do I see what changed?**
`/skill-coach:analyze` lists every change since you last ran it, or read `changes.md`.

**How do I stop it for one skill?**
Set `"score_after_run": "off"` for that skill in `config.json`. Runs are still
recorded.

**Does it learn from my undos?**
Yes. An undo counts as a rejection of that fix. A scoring rule rejected 3 times is
proposed for removal, and a problem seen in 2 skills is proposed as a general rule.
These changes always wait for your approval.

**Will one lucky run rewrite my skill?**
No. A single run only becomes a lesson when it proves it, and evidence older than the
last fix for the same problem is ignored.
