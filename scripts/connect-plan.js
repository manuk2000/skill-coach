#!/usr/bin/env node
'use strict';

// Read-only planner for /skill-coach:connect. It finds a skill and works out the two
// exact edits (the frontmatter block and the Self-improvement section) that the chat
// applies with its Edit tool, so nobody retypes the skill file. Never writes anything.
//   node connect-plan.js --skill <name> [--cwd <dir>] [--root user|project] [--rubric <path>] [--hand-over <text>]
//   node connect-plan.js --list [--cwd <dir>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isConnected, countRuns, dataDir } = require('./log-run.js');

const DEFAULT_RUBRIC = 'references/rubric.md';
const POINTER = [
  "At the end of every run — and again if the user's next message corrects the",
  'result — invoke `skill-coach:run-end`. Settings live in the skill-coach data',
  'folder, not here.',
];
const HEADING = /^## Self-improvement\b/i;

const occurrences = (text, s) => text.split(s).length - 1;

function sectionText(eol, handOver) {
  return ['## Self-improvement', '', ...POINTER, ...(handOver ? ['', handOver] : [])].join(eol);
}

function findHeading(lines) {
  let inFence = false;
  let at = -1;
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) inFence = !inFence;
    else if (!inFence && HEADING.test(l)) at = i;
  });
  if (at < 0) return null;
  let end = lines.length;
  inFence = false;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i])) inFence = !inFence;
    else if (!inFence && /^## /.test(lines[i])) { end = i; break; }
  }
  while (end > at + 1 && !lines[end - 1].trim()) end -= 1;
  return { at, end };
}

function planConnect(text, { rubric = DEFAULT_RUBRIC, handOver = '' } = {}) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text.endsWith(eol) ? text.slice(0, -eol.length) : text;
  const lines = body.split(eol);
  if (!/^﻿?---$/.test(lines[0])) return { error: 'the skill has no frontmatter (it must start with ---)' };
  const fmEnd = lines.indexOf('---', 1);
  if (fmEnd < 0) return { error: 'the frontmatter is never closed with ---' };
  if (lines.slice(1, fmEnd).some((l) => l.startsWith('skill-coach:'))) {
    return { state: 'connected', sectionMode: null, existingSection: null, edits: [] };
  }

  // Frontmatter: the shortest run of lines ending at the closing --- that occurs once.
  let fmEdit = null;
  for (let start = fmEnd - 1; start >= 1 && !fmEdit; start--) {
    const old = lines.slice(start, fmEnd + 1).join(eol);
    if (occurrences(text, old) === 1) {
      const kept = lines.slice(start, fmEnd).join(eol);
      fmEdit = { old_string: old, new_string: [kept, 'skill-coach:', `  rubric: ${rubric}`, '---'].join(eol) };
    }
  }
  if (!fmEdit) return { error: 'no unique place to add the frontmatter block' };

  const section = sectionText(eol, handOver);
  const found = findHeading(lines);
  let sectionEdit = null;
  let existingSection = null;
  if (found) {
    existingSection = lines.slice(found.at, found.end).join(eol);
    if (occurrences(text, existingSection) !== 1) return { error: 'the existing Self-improvement section is not unique' };
    sectionEdit = { old_string: existingSection, new_string: section };
  } else {
    for (let start = lines.length - 1; start > fmEnd && !sectionEdit; start--) {
      const tail = lines.slice(start).join(eol);
      if (tail.trim() && occurrences(text, tail) === 1) sectionEdit = { old_string: tail, new_string: `${tail}${eol}${eol}${section}` };
    }
    if (!sectionEdit) return { error: 'no unique place to append the Self-improvement section' };
  }

  // Apply both edits to a copy, in order, to prove each anchor still occurs exactly once.
  let check = text;
  for (const edit of [fmEdit, sectionEdit]) {
    if (occurrences(check, edit.old_string) !== 1) return { error: 'the planned edits overlap; connect this skill by hand' };
    check = check.replace(edit.old_string, edit.new_string);
  }
  return { state: 'not-connected', sectionMode: found ? 'replace' : 'append', existingSection, edits: [fmEdit, sectionEdit] };
}

function findSkill(name, { home, cwd, root }) {
  if (name.includes(':')) return { error: 'plugin skills cannot be edited — ask the plugin author to connect it' };
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith('.')) return { error: `"${name}" is not a skill name` };
  const places = [['user', path.join(home, '.claude', 'skills', name)]];
  const projectDir = path.join(cwd, '.claude', 'skills', name);
  if (path.resolve(projectDir) !== path.resolve(places[0][1])) places.push(['project', projectDir]);
  const found = places.filter(([r, dir]) => (!root || r === root) && fs.existsSync(path.join(dir, 'SKILL.md')));
  if (found.length === 0) return { error: `skill "${name}" not found in ~/.claude/skills or ./.claude/skills` };
  if (found.length > 1) return { error: `"${name}" exists in both your skills and this project — pass --root user or --root project` };
  const [r, dir] = found[0];
  return {
    root: r, dir, file: path.join(dir, 'SKILL.md'),
    warning: r === 'project' ? 'this skill lives in a project folder; the change will show in git' : null,
  };
}

function listSkills({ home, cwd, ledger }) {
  const out = [];
  for (const [root, base] of [['user', path.join(home, '.claude', 'skills')], ['project', path.join(cwd, '.claude', 'skills')]]) {
    if (root === 'project' && path.resolve(base) === path.resolve(path.join(home, '.claude', 'skills'))) continue;
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const skill of names) {
      if (!fs.existsSync(path.join(base, skill, 'SKILL.md'))) continue;
      out.push({ skill, root, connected: isConnected(skill, cwd, home), runs: countRuns(ledger, skill) });
    }
  }
  return out.sort((a, b) => (a.connected - b.connected) || (b.runs - a.runs) || a.skill.localeCompare(b.skill));
}

function rubricOf(text) {
  const m = text.match(/^skill-coach:\r?\n\s+rubric:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

function main(argv, env) {
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const home = env.HOME || os.homedir();
  const cwd = opt('--cwd') || process.cwd();
  if (argv.includes('--list')) {
    return { ok: true, skills: listSkills({ home, cwd, ledger: path.join(dataDir(env), 'ledger.jsonl') }) };
  }
  const name = opt('--skill');
  if (!name) return { ok: false, reason: 'usage: connect-plan.js --skill <name> | --list' };
  const where = findSkill(name, { home, cwd, root: opt('--root') });
  if (where.error) return { ok: false, reason: where.error };
  const text = fs.readFileSync(where.file, 'utf8');
  const plan = planConnect(text, { rubric: opt('--rubric') || DEFAULT_RUBRIC, handOver: opt('--hand-over') || '' });
  if (plan.error) return { ok: false, reason: plan.error, file: where.file };
  const rel = plan.state === 'connected' ? (rubricOf(text) || DEFAULT_RUBRIC) : (opt('--rubric') || DEFAULT_RUBRIC);
  const rubricPath = path.join(where.dir, rel);
  return {
    ok: true, skill: name, root: where.root, file: where.file, warning: where.warning,
    state: plan.state, sectionMode: plan.sectionMode, existingSection: plan.existingSection,
    rubric: { path: rubricPath, exists: fs.existsSync(rubricPath) }, edits: plan.edits,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(main(process.argv.slice(2), process.env), null, 2) + '\n');
}

module.exports = { planConnect, findSkill, listSkills };
