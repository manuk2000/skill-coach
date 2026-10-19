#!/usr/bin/env node
'use strict';

// Hook script: records one ledger line per skill run, at zero AI cost.
//   node log-run.js tool    — PreToolUse on the Skill tool
//   node log-run.js typed   — UserPromptSubmit (only prompts starting with "/")
// It must never get in the way of a skill: it always exits 0 and prints nothing,
// except the spot-check note on every 10th run of a connected skill.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SPOT_CHECK_EVERY = 10;

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

function isConnected(skill, cwd, home) {
  if (!skill || skill.includes(':')) return false;
  for (const root of [home, cwd]) {
    try {
      const text = fs.readFileSync(path.join(root, '.claude', 'skills', skill, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
      if (!text.startsWith('---\n')) continue;
      const end = text.indexOf('\n---', 4);
      if (end < 0) continue;
      if (text.slice(4, end).split('\n').some((line) => line.startsWith('skill-coach:'))) return true;
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
    if (n % SPOT_CHECK_EVERY === 0 && isConnected(skill, cwd, home)) {
      output = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: mode === 'typed' ? 'UserPromptSubmit' : 'PreToolUse',
          additionalContext: `skill-coach: spot check due for ${skill} (run ${n}). At the end of this run, score it even if nothing went wrong.`,
        },
      });
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

module.exports = { dataDir, skillFromEvent, isConnected, countRuns, main };
