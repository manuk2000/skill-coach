#!/usr/bin/env node
'use strict';

// Development check for this public repo: fails when text going into it holds private
// words — names, hosts, ticket keys or examples from a private workplace. The words live
// OUTSIDE the repo, in a list only the developer has: SKILL_COACH_PRIVATE_WORDS, else
// ~/.config/skill-coach/private-words.txt. One entry per line: a word (case-insensitive)
// or `re:<regex>`; `#` starts a comment. Two generic checks run even without the list.
//   node privacy-check.js --staged          added lines and names of staged files
//   node privacy-check.js --message <file>  a commit message (git's # lines skipped)
//   node privacy-check.js --range <a..b>    every commit in the range: patch and message
//   node privacy-check.js --pre-push        the ranges git passes to a pre-push hook
//   node privacy-check.js --tree            every tracked file
// Exits 0 when clean, 1 on a match, 2 on a usage error.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ZERO = /^0+$/;
const GENERIC = [
  // A placeholder such as /Users/<name> is fine; a real name is not.
  { label: 'a personal home folder (/Users/<name>)', re: /\/Users\/(?!<)[^/\s`'")<>]+/ },
  {
    label: 'an email address (only no-reply and example addresses belong here)',
    re: /[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com\b|example\.(?:com|org)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/,
  },
];

function listPath(env) {
  return env.SKILL_COACH_PRIVATE_WORDS || path.join(env.HOME || os.homedir(), '.config', 'skill-coach', 'private-words.txt');
}

// The private rules from the list, or null when there is no list.
function loadRules(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const re = line.startsWith('re:')
      ? new RegExp(line.slice(3), 'i')
      : new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    rules.push({ label: line, re });
  }
  return rules;
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout;
}

// The added lines of a unified diff, each with its file and new line number, plus the
// names of the files it touches.
function addedLines(diff) {
  const lines = [];
  const names = new Set();
  let file = null;
  let at = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(4).replace(/^b\//, '');
      if (file) names.add(file);
    } else if (line.startsWith('@@')) {
      const m = /\+(\d+)/.exec(line);
      at = m ? Number(m[1]) : 0;
    } else if (line.startsWith('+') && file) {
      lines.push({ where: `${file}:${at}`, text: line.slice(1) });
      at += 1;
    }
  }
  return { lines, names: [...names] };
}

function scan(items, rules) {
  const hits = [];
  for (const { where, text } of items) {
    for (const rule of rules) {
      if (rule.re.test(text)) hits.push(`${where}: matches "${rule.label}"`);
    }
  }
  return hits;
}

function fromDiff(diff, prefix = '') {
  const { lines, names } = addedLines(diff);
  return [
    ...names.map((name) => ({ where: `${prefix}${name}`, text: name })),
    ...lines.map((l) => ({ where: `${prefix}${l.where}`, text: l.text })),
  ];
}

function staged() {
  return fromDiff(git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff']));
}

function message(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((text, i) => ({ where: `commit message:${i + 1}`, text }))
    .filter((l) => !l.text.startsWith('#'));
}

function commits(spec) {
  const items = [];
  for (const sha of git(['rev-list', ...spec]).split('\n').filter(Boolean)) {
    const short = sha.slice(0, 7);
    for (const text of git(['log', '-1', '--format=%B', sha]).split('\n')) {
      items.push({ where: `${short} message`, text });
    }
    items.push(...fromDiff(git(['show', '-U0', '--no-color', '--no-ext-diff', '--format=', sha]), `${short} `));
  }
  return items;
}

// git gives a pre-push hook one line per ref: <local ref> <local sha> <remote ref> <remote sha>.
function prePush(input) {
  const items = [];
  for (const line of input.split('\n')) {
    const [, local, , remote] = line.trim().split(/\s+/);
    if (!local || ZERO.test(local)) continue;
    items.push(...commits(remote && !ZERO.test(remote) ? [`${remote}..${local}`] : [local, '--not', '--remotes']));
  }
  return items;
}

function tree() {
  const items = [];
  for (const name of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    items.push({ where: name, text: name });
    let buf;
    try {
      buf = fs.readFileSync(name);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    buf.toString('utf8').split('\n').forEach((text, i) => items.push({ where: `${name}:${i + 1}`, text }));
  }
  return items;
}

function main(argv, env, stdin) {
  const [mode, value] = argv;
  let items;
  try {
    if (mode === '--staged') items = staged();
    else if (mode === '--message' && value) items = message(value);
    else if (mode === '--range' && value) items = commits([value]);
    else if (mode === '--pre-push') items = prePush(stdin());
    else if (mode === '--tree') items = tree();
    else {
      process.stderr.write('usage: privacy-check.js --staged | --message <file> | --range <a..b> | --pre-push | --tree\n');
      return 2;
    }
  } catch (err) {
    process.stderr.write(`privacy-check: ${err.message}\n`);
    return 2;
  }
  const file = listPath(env);
  const privateRules = loadRules(file);
  if (!privateRules) process.stderr.write(`privacy-check: no private word list at ${file}; only the generic checks ran\n`);
  const hits = scan(items, [...GENERIC, ...(privateRules || [])]);
  if (hits.length === 0) return 0;
  process.stdout.write(hits.map((h) => `privacy-check: ${h}\n`).join(''));
  process.stderr.write(`privacy-check: ${hits.length} private match(es). Nothing private may enter this public repo — `
    + 'remove them, or fix the word list if a match is wrong. Never bypass this with --no-verify.\n');
  return 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), process.env, () => fs.readFileSync(0, 'utf8'));
}

module.exports = { loadRules, addedLines, scan, main };
