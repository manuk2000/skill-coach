#!/usr/bin/env node
'use strict';

// Finds a skill's family: the connected skills that name the same shared folder in
// their frontmatter (`shared:` under `skill-coach:`). Read-only: prints JSON, writes nothing.
//   node family.js --skill <name> [--cwd <dir>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { frontmatter } = require('./log-run.js');

// The indented lines under `skill-coach:` in the frontmatter, or null when there is no such block.
function coachBlock(text) {
  const fm = frontmatter(text);
  if (!fm) return null;
  const lines = fm.lines.slice(1, fm.end);
  const at = lines.findIndex((l) => l.startsWith('skill-coach:'));
  if (at < 0) return null;
  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && !/^\s/.test(line)) break;
    block.push(line);
  }
  return block;
}

// One spelling per folder, so `~/x/`, `/home/u/x` and `/home/u/x/` are the same family.
function folder(value, home) {
  let v = value.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (!v) return null;
  if (v === '~' || v.startsWith('~/')) v = path.join(home, v.slice(1));
  v = path.normalize(v).replace(/\/+$/, '');
  return v || null;
}

function sharedOf(text, home) {
  const block = coachBlock(text);
  if (!block) return null;
  for (const line of block) {
    const m = /^\s+shared:\s*(.*)$/.exec(line);
    if (m) return folder(m[1], home);
  }
  return null;
}

// The connected skills under <root>/.claude/skills, each with its shared folder (or null).
function scan(root, home) {
  const base = path.join(root, '.claude', 'skills');
  let names;
  try {
    names = fs.readdirSync(base).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    try {
      const text = fs.readFileSync(path.join(base, name, 'SKILL.md'), 'utf8');
      if (coachBlock(text)) found.push({ skill: name, skill_dir: path.join(base, name), shared: sharedOf(text, home) });
    } catch {
      // Not a skill folder.
    }
  }
  return found;
}

function familyOf(skill, { home, cwd }) {
  const roots = [...new Set([home, cwd].map((r) => path.resolve(r)))];
  const all = roots.flatMap((root) => scan(root, home));
  const own = all.find((s) => s.skill === skill && s.shared);
  if (!own) return { shared: null, members: [] };
  const members = all
    .filter((s) => s.shared === own.shared)
    .map(({ skill: name, skill_dir: dir }) => ({ skill: name, skill_dir: dir }))
    .sort((a, b) => (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0));
  return { shared: own.shared, members };
}

function main(argv, env) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const skill = arg('--skill');
  if (!skill) {
    process.stdout.write(JSON.stringify({ error: 'usage: family.js --skill <name> [--cwd <dir>]' }) + '\n');
    return 1;
  }
  try {
    const family = familyOf(skill, { home: env.HOME || os.homedir(), cwd: arg('--cwd') || process.cwd() });
    process.stdout.write(JSON.stringify(family) + '\n');
    return 0;
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);

module.exports = { sharedOf, familyOf, folder };
