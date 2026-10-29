#!/usr/bin/env node
'use strict';

// Hook script: records one ledger line per skill run, at zero AI cost.
//   node log-run.js tool    — PreToolUse on the Skill tool
//   node log-run.js typed   — UserPromptSubmit (only prompts starting with "/")
// It must never get in the way of a skill: it always exits 0, and prints only a short
// note for a connected skill (which run this is, plus a spot check every 10th run).
// When skill-coach:run-end starts it also reads the run that is ending (the skill named in
// the call's args, else the newest connected run), and prints a cost note if that run (or
// one of its subagents) received a very large tool result.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRun, subagentReader } = require('./read-run.js');

const SPOT_CHECK_EVERY = 10;
const RUN_END = 'skill-coach:run-end';
const DEFAULT_LARGE_RESULT_KB = 40;

function dataDir(env) {
  if (env.SKILL_COACH_DATA) return env.SKILL_COACH_DATA;
  return path.join(env.HOME || os.homedir(), '.claude', 'self-improvement');
}

function exists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function skillFromEvent(mode, event, cwd, home) {
  if (mode === 'tool') {
    const skill = event.tool_input && event.tool_input.skill;
    return typeof skill === 'string' && skill ? skill : null;
  }
  const match = /^\/([A-Za-z0-9_.:-]+)/.exec(String(event.prompt || '').trimStart());
  if (!match) return null;
  const name = match[1];
  if (name.includes(':')) return name;
  const candidates = [
    path.join(home, '.claude', 'skills', name, 'SKILL.md'),
    path.join(home, '.claude', 'commands', `${name}.md`),
    path.join(cwd, '.claude', 'skills', name, 'SKILL.md'),
    path.join(cwd, '.claude', 'commands', `${name}.md`),
  ];
  return candidates.some(exists) ? name : null;
}

// The frontmatter's lines and the index of its closing line, or null. Shared with
// connect-plan.js so "connected" means the same thing to both.
function frontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0])) return null;
  const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  return end < 0 ? null : { lines, end };
}

function isConnected(skill, cwd, home) {
  if (!skill || skill.includes(':')) return false;
  for (const root of [home, cwd]) {
    try {
      const fm = frontmatter(fs.readFileSync(path.join(root, '.claude', 'skills', skill, 'SKILL.md'), 'utf8'));
      if (fm && fm.lines.slice(1, fm.end).some((line) => line.startsWith('skill-coach:'))) return true;
    } catch {
      // Not in this folder.
    }
  }
  return false;
}

function countRuns(ledgerPath, skill) {
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of text.split('\n')) {
    try {
      const row = JSON.parse(line);
      if (row && row.type === 'run' && row.skill === skill) n += 1;
    } catch {
      // A broken line counts as nothing.
    }
  }
  return n;
}

// A setting for one skill from config.json: its own entry, else the defaults; undefined
// when neither has a value that `valid` accepts or the file cannot be read.
function setting(dir, skill, key, valid) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    const own = config.skills && config.skills[skill];
    return [own && own[key], config.defaults && config.defaults[key]].find(valid);
  } catch {
    return undefined;
  }
}

// The size, in KB, from which one tool result starts a cost check: the skill's own
// setting, else the default for all skills, else 40.
function largeResultKb(dir, skill) {
  const value = setting(dir, skill, 'large_result_kb', (v) => Number.isFinite(v) && v > 0);
  return value === undefined ? DEFAULT_LARGE_RESULT_KB : value;
}

// The tools whose results never start a cost check for this skill (the judge adds a tool
// here when it rules its large result unavoidable).
function largeResultIgnore(dir, skill) {
  const list = setting(dir, skill, 'large_result_ignore', Array.isArray);
  return list ? list.filter((t) => typeof t === 'string' && t) : [];
}

// The run that is ending: the newest run row of this session and agent (a row with no
// agent when the event has none) that is not skill-coach's own and that `isWanted` accepts.
function endedRun(ledgerPath, session, agent, isWanted = () => true) {
  if (!session) return null;
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes(session)) continue;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!row || row.type !== 'run' || row.session !== session) continue;
    if (agent ? row.agent !== agent : row.agent) continue;
    if (typeof row.skill !== 'string' || row.skill.startsWith('skill-coach:')) continue;
    if (!isWanted(row)) continue;
    return row;
  }
  return null;
}

// One sentence when the run's biggest result is at or over the limit: the main run first
// (its biggest result, or an over-limit error), then a subagent's biggest result.
function costNote(skill, facts, limitKb) {
  const head = `skill-coach: cost check due for ${skill} — `;
  const tail = '; score this run.';
  const results = facts.results || {};
  const top = results.largest && results.largest[0];
  if (top && top.kb >= limitKb) return `${head}largest result ${Math.round(top.kb)} KB from ${top.tool || 'a tool'} (main)${tail}`;
  if (results.oversize_errors > 0) return `${head}a result was over the tool's size limit (main)${tail}`;
  let big = null;
  for (const sub of facts.subagents || []) {
    if (sub.largest_kb >= limitKb && (!big || sub.largest_kb > big.largest_kb)) big = sub;
  }
  if (big) return `${head}largest result ${Math.round(big.largest_kb)} KB from ${big.largest_tool || 'a tool'} (subagent)${tail}`;
  return null;
}

// The skill run-end was told it is ending: the first word of the Skill call's args.
function namedSkill(event) {
  const args = event.tool_input && event.tool_input.args;
  const first = typeof args === 'string' ? args.trim().split(/\s+/)[0].replace(/^\//, '') : '';
  return first || null;
}

// Reads the transcript of the run that run-end is about to score. Any trouble means no note.
function runEndNote(event, ledger, dir, cwd, home) {
  try {
    // The skill named in the args first; else the newest connected run, passing over newer
    // rows of unconnected skills (a helper the run called).
    const named = namedSkill(event);
    const connected = (r) => isConnected(r.skill, r.cwd, home) || isConnected(r.skill, cwd, home);
    const row = (named && endedRun(ledger, event.session_id, event.agent_id, (r) => r.skill === named))
      || endedRun(ledger, event.session_id, event.agent_id, connected);
    if (!row || !row.transcript) return null;
    const lines = fs.readFileSync(row.transcript, 'utf8').split('\n');
    const facts = readRun(lines, row.skill, {
      readSubagent: subagentReader(row.transcript), ignoreTools: largeResultIgnore(dir, row.skill),
    });
    return facts.found ? costNote(row.skill, facts, largeResultKb(dir, row.skill)) : null;
  } catch {
    return null;
  }
}

function transcriptFor(event) {
  const t = event.transcript_path || null;
  if (t && event.agent_id && event.session_id) {
    return path.join(path.dirname(t), event.session_id, 'subagents', `agent-${event.agent_id}.jsonl`);
  }
  return t;
}

function main(mode, stdinText, env, now) {
  const nothing = { line: null, output: null };
  try {
    const event = JSON.parse(stdinText);
    if (!event || typeof event !== 'object' || Array.isArray(event)) return nothing;
    const home = env.HOME || os.homedir();
    const cwd = event.cwd || process.cwd();
    const skill = skillFromEvent(mode, event, cwd, home);
    if (!skill) return nothing;

    const dir = dataDir(env);
    const ledger = path.join(dir, 'ledger.jsonl');
    const n = countRuns(ledger, skill) + 1;
    const line = {
      type: 'run',
      time: now.toISOString(),
      session: event.session_id || null,
      transcript: transcriptFor(event),
      cwd,
      skill,
      via: mode === 'typed' ? 'typed' : 'tool',
      n,
    };
    if (event.agent_id) line.agent = event.agent_id;

    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(ledger, JSON.stringify(line) + '\n');

    let output = null;
    if (isConnected(skill, cwd, home)) {
      // Tells the chat which run this is, so run-end scores this session's run.
      const who = `session ${line.session}${line.agent ? `, agent ${line.agent}` : ''}`;
      let note = `skill-coach: run ${n} of ${skill} recorded (${who}). At the end of this run, invoke skill-coach:run-end.`;
      if (n % SPOT_CHECK_EVERY === 0) note += ` skill-coach: spot check due for ${skill} — score this run even if nothing went wrong.`;
      output = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: mode === 'typed' ? 'UserPromptSubmit' : 'PreToolUse',
          additionalContext: note,
        },
      });
    } else if (mode === 'tool' && skill === RUN_END) {
      const note = runEndNote(event, ledger, dir, cwd, home);
      if (note) output = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } });
    }
    return { line, output };
  } catch {
    return nothing;
  }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const { output } = main(process.argv[2], input, process.env, new Date());
    if (output) process.stdout.write(output);
    process.exitCode = 0;
  });
}

module.exports = {
  dataDir, skillFromEvent, frontmatter, isConnected, countRuns, largeResultKb, largeResultIgnore, endedRun, costNote, main,
};
