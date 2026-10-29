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
- [Skill families](#skill-families)
- [Choosing a subagent's model](#choosing-a-subagents-model)
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
   an unusually long run, a very large tool result, a request the skill has no step
   for, or a spot check. This run had none, so it stops here and prints nothing. No
   agents run.
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
two cards, one at a time:

| Card | Question | Shown above it | Options |
|---|---|---|---|
| 1 | Save these rules for release-notes? | What it decided from your skill, each with a reason, and the draft rules | **Save them** · Stop here |
| 2 | Make these 2 changes to SKILL.md? | Both changes, before and after | **Yes, connect it** · No, stop here |

The suggested option is shown in bold. Auto-fix is turned on without asking: when a
run goes wrong, skill-coach fixes the skill by itself and `/skill-coach:undo` reverses
it. To have fixes wait for your approval instead, set `logic_auto` to `off` (see
Settings).

- Type a change on any card instead of picking an option, and it is taken into
  account.
- Run `/skill-coach:connect` without a name to see your unconnected skills, most used
  first.
- Skills that come from a plugin can't be connected; only your own skills can.
- It also lists problems it noticed in the skill itself (a dead link, two rules that
  contradict). It reports them and never fixes them.
- If the skill reads a folder that another skill reads too, the two can form a
  [family](#skill-families). One folder is shown as already decided; two or more are
  one extra question, with "No family" as an answer.
- Run it again on a skill you connected earlier to bring it up to date. It replaces the
  old pointer sentence with the current one and can add the family line, in one card
  you confirm. Its rules, its `Hand over:` line and its auto-fix setting stay as they
  are, and a `## Self-improvement` section you wrote yourself is never rewritten.
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
result or asks to add something to the skill — invoke `skill-coach:run-end`.
Settings live in the skill-coach data folder, not here.
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
| A large result | One tool result of 40 KB or more came into the run, or into one of its subagents. See the cost check below. |
| You asked for something new | Part of your request had no step in the skill, so the run improvised it. Or your next message says *"add this to the skill"* or *"do this every time"*. |
| A spot check | Every 10th run of a skill is scored even when nothing went wrong. |
| You asked | `/skill-coach:analyze` scores this session's unscored runs. |

A skill is scored at most once per session, apart from a request after the line (below).
If you correct a run that was already scored, the new score replaces the old one, and
any second fix waits for your approval instead of being applied.

**The cost check.** As a run ends, the hook measures the biggest tool result of the run
and of its subagents. This costs nothing. At 40 KB of text or more (the
`large_result_kb` setting), the run is scored. Images and documents never count, and a
result the tool refused as too large does. The judge asks one question: *could the
skill have fetched less?* It looks for a filter or limit at the source, a count or size
probe before the full fetch, only the fields that were needed, the bulk handed to a
subagent, or a copy that was already fetched. Fetching the same large payload twice
costs more points. A fix changes the method in the skill's own step; it never just
lowers a number. Nothing is taken off when you asked to see the whole payload. The
score line shows the cost, see below.

**Requests.** Asking for something new is never marked down. The skill never claimed
to do it, so the run is scored as usual. What happens next depends on the request:

- **Lasting** when you said so (*"add"*, *"always"*, *"next time"*, *"from now on"*),
  or when it is one more of the things the skill exists for, such as a new kind of item
  for a skill that keeps a list of them. It is added to the skill, written from the
  steps of this run that worked (the query that returned data, the command that
  exited clean). If the run never managed it, the addition is marked untested and waits
  for your approval.
- **One-off** when it was about this case only. It is noted. If the same request
  comes a second time, it counts as lasting. When unsure, it counts as one-off.
- **Outside the skill's purpose.** It is never added. The line says so in a few words.
- **A correction comes first.** If you also corrected the run, the request waits
  and the correction is fixed. The request is picked up the next time it is seen.

A request you make after the line is scored on its own, as a new row, so it can be
added even when the run already had a fix.

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

Asking for something new never costs points. A skill that hands its work to subagents
is also checked on whether each one ran on the right model, see
[Choosing a subagent's model](#choosing-a-subagents-model).

The line takes one of these shapes. After the score it also shows what the run cost,
as `~85k tokens`: the tokens of the run and of its subagents, cache reads left out.
The examples leave that figure out, except where it is the point.

| Line | What it means |
|---|---|
| `🟡 6/10 · Changed SKILL.md → «…» · Undo: /skill-coach:undo` | A fix was applied. The quote is the start of the new text. |
| `🟡 6/10 · Changed facts.md + 2 pointers · Undo: /skill-coach:undo` | A fact shared by a [family](#skill-families) was written once, and two copies became pointers. |
| `🟡 6/10 · 1 fix waiting (P-20261025-001)` | A fix needs your decision; see it in `/skill-coach:analyze`. |
| `🟡 6/10 · largest 140 KB (fetch_records) · ~85k tokens` | The cost check fired. The biggest tool result was 140 KB, from `fetch_records`, and the run used about 85,000 tokens. Any fix follows, as in the rows above. |
| `🟢 9/10 · ~12k tokens · Not added (outside the skill): posting the notes to chat` | You asked for something the skill is not meant to do. It was not added. |
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
| A fact the skills of a [family](#skill-families) share | Applied, written once in the family folder (setting `text_auto`) |
| A rule in a family folder | Always waits for you. It would change every skill of the family at once. |
| An addition the run never managed to do | Always waits for you, marked untested. |
| The skill's scoring rules | Always waits for you. The judge never changes the rules it scores by. |
| Anything outside the skill's folder | Always waits for you: a `CLAUDE.md`, memory, another skill. The family folder and the pointer lines below are the exception. |
| The plugin's own files | Always waits for you. |
| A broken setup | Only reported. |

- At most one change per run: the fix for the biggest problem. A lasting request is the
  exception that goes first, unless you corrected the run.
- It never deletes content and never changes a safety or permission rule. There is
  one exception: when a fact moves to a family folder, each exact copy of it in a
  skill is replaced by a one-line pointer, `see <file> — <section>`. That moves a fact
  and changes no rule. Copies inside a code block or a quoted example stay.
- It edits one section in place. It never appends a "lessons learned" list to the end
  of a skill.
- A lesson from a single run is written down only when the run proves it: a passing
  check, a named failure, and an approach tried and ruled out.

Fixes that wait for you are kept in `proposals.md`; approve or reject them in
`/skill-coach:analyze`. The full scoring rules are in
[`criteria/general.md`](../criteria/general.md).

## Skill families

Skills that need the same facts (a project name, an id, a path) can share one folder
for them. Name the folder under `skill-coach:` in each skill's frontmatter:

```yaml
skill-coach:
  rubric: references/rubric.md
  shared: ~/.claude/demo-shared
```

The connected skills that name the same folder are a family. `/skill-coach:connect`
adds the line for you when the skill reads a folder that another skill reads too. A
skill you connected earlier is brought into a family by running connect on it again.

Here is how it works with `release-notes` and a second skill, `demo-skill`. Both say
*"Records live in the project `ops-records`."* A run of `release-notes` fails because
that project does not exist; the skill looked and found `team-records`.

1. **The judge** reads the notes of both skills. A problem seen in more than one skill
   is one family problem, and a fact two skills state belongs in the shared folder.
2. **The worker** writes *"Records live in the project `team-records`."* once, under a
   `Records` heading in `~/.claude/demo-shared/facts.md`.
3. **In each skill**, the sentence is replaced by
   `see ~/.claude/demo-shared/facts.md — Records`.
4. **You see** `🟡 6/10 · Changed facts.md + 2 pointers · Undo: /skill-coach:undo`.

Some things to know:

- Notes stay per skill. The judge reads the notes of every member, but each skill keeps
  its own scores and problems.
- The fact is applied under the scored skill's `text_auto`; when that is off, the fact
  and its pointers wait together in `proposals.md`. Otherwise each pointer is applied
  under its own skill's `text_auto`, and a pointer whose skill has it off waits in
  `proposals.md` while the rest of the change is applied.
- A rule in the family folder always waits for you.
- `/skill-coach:undo` reverts the whole change, every file, or none of them: if a file
  changed since, it restores nothing and shows you the backup folder.
- Undo never deletes a file. A file the change created (the first `facts.md`) stays.
  When it still holds only what the change wrote, you get a line to run yourself:
  `rm "<path>"`.
- `/skill-coach:analyze` shows each family next to the per-skill table: which members
  ran, the family changes applied and undone, and the problems seen in two or more
  members.

## Choosing a subagent's model

When a skill hands data to a subagent, the model should fit the job. Every scored run
checks each subagent against this table, a spot check included:

| What the subagent does with the data | Model |
|---|---|
| Fetches it, then counts, filters or picks fields. No judgement. | `haiku` |
| Groups it, compares it, reads a trace or stack and says what matters. | `sonnet` |
| Decides, interprets, recommends. | No subagent. The main session does it. |
| The data is small, under about 10 KB. | No subagent. Read it directly. |

A subagent that does not fit costs 2 points: too strong (a stronger model only fetched
or counted), too weak (the main session had to redo or correct its work), or started
for data small enough to read directly. When the model that ran is not known, the model
the skill asked for is used; when neither is known, nothing is taken off. Nothing is
taken off when you asked to see the whole payload.

A skill whose subagents do different jobs chooses per job. The fix writes the model
into the skill's own step that starts the subagent, for example *"start it with
`model: haiku`"*. A skill cannot read the plugin's files while it runs, so the choice
has to be in its own text. A large result inside a subagent is judged only by this
check: keeping the bulk out of the main session was right.

## Commands

| Command | What it does |
|---|---|
| `/skill-coach:connect [skill] [--root user\|project]` | Connects one skill, or brings a connected one up to date. Without a name, lists your unconnected skills. `--root` chooses between your user skills and the project's skills. |
| `/skill-coach:undo [change id]` | Reverts a change; the last one when no id is given. It reverts only that change's text. If the text was edited since, it refuses and shows you the backup instead. It never deletes a file the change created; it gives you the `rm` line. |
| `/skill-coach:analyze [skill] [period]` | What changed since last time, fixes waiting for your approval, how often each skill and each family had trouble, problems that keep coming back, and busy skills that aren't connected yet. Period: `session` (default), `7d`, `30d` or `all`. |

## Settings

In `~/.claude/self-improvement/config.json`. Each setting has a default for all
skills, and any skill can override it.

| Setting | Controls | Default |
|---|---|---|
| `text_auto` | Wording fixes apply by themselves | `on` |
| `logic_auto` | Step and rule fixes apply by themselves | `on`, asked once per skill |
| `score_after_run` | Runs with trouble get scored at the end | `on` |
| `large_result_kb` | The size in KB of text from which one tool result starts a cost check | `40` |

```json
{
  "defaults": { "text_auto": "on", "logic_auto": "on", "score_after_run": "on", "large_result_kb": 40 },
  "skills": {
    "release-notes": { "logic_auto": "off", "large_result_kb": 80 }
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
A clean run costs almost nothing: one log line and a quick check. Only a scored run
(trouble, a very large result, or a request) starts the judge (Opus) and the worker
(Sonnet), and its line shows what it cost. Models are chosen by name family, so newer
versions are used automatically.

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
