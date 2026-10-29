#!/usr/bin/env node
'use strict';

// Read-only planner for /skill-coach:connect. It finds a skill and works out the two
// exact edits (the frontmatter block and the Self-improvement section) that the chat
// applies with its Edit tool, so nobody retypes the skill file. Never writes anything.
//   node connect-plan.js --skill <name> [--cwd <dir>] [--root user|project] [--rubric <path>] [--hand-over <text>] [--shared <folder>]
//   node connect-plan.js --list [--cwd <dir>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { frontmatter, isConnected, countRuns, dataDir } = require('./log-run.js');
const { sharedOf, folder } = require('./family.js');

const DEFAULT_RUBRIC = 'references/rubric.md';
const POINTER = [
  "At the end of every run — and again if the user's next message corrects the",
  'result or asks to add something to the skill — invoke `skill-coach:run-end`',
  "with this skill's name as its argument. Settings live in the skill-coach data",
  'folder, not here.',
];
// Every pointer sentence ends with this line; run-end reads the hand-over after it.
const POINTER_END = 'not here.';
// "## Self-improvement", optionally with a note in brackets — never "… wiring" or "-loop".
const HEADING = /^##\s+Self-improvement\s*(\([^)]*\))?\s*$/i;

const occurrences = (text, s) => text.split(s).length - 1;

// A folder as a YAML value: plain when it is only path characters, else single-quoted
// (a ' inside is written twice), so ` #` or `: ` in a typed folder cannot change the YAML.
const yamlValue = (v) => (/^[\w~./-]+$/.test(v) && v !== '~' ? v : `'${v.replace(/'/g, "''")}'`);

function sectionText(eol, handOver) {
  return ['## Self-improvement', '', ...POINTER, ...(handOver ? ['', handOver] : [])].join(eol);
}

// For each line, whether it is part of a fenced code block (CommonMark: a fence closes
// only with the same character, at least as long, and no info string).
function fenced(lines) {
  let open = null;
  return lines.map((l) => {
    const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (m) open = { ch: m[1][0], len: m[1].length };
      return Boolean(m);
    }
    if (m && m[1][0] === open.ch && m[1].length >= open.len && !m[2].trim()) open = null;
    return true;
  });
}

function findHeading(lines) {
  const inFence = fenced(lines);
  const hits = lines.map((l, i) => i).filter((i) => !inFence[i] && HEADING.test(lines[i]));
  if (hits.length === 0) return null;
  if (hits.length > 1) return { error: 'the skill has several Self-improvement sections; connect it by hand' };
  const at = hits[0];
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (!inFence[i] && /^#{1,2}\s/.test(lines[i])) { end = i; break; }
  }
  while (end > at + 1 && !lines[end - 1].trim()) end -= 1;
  return { at, end };
}

// The pointer sentence inside the section: the paragraph that ends with the first line ending
// POINTER_END. Null when there is no section or no such line (connected by hand).
function pointerSpan(lines) {
  const found = findHeading(lines);
  if (!found || found.error) return null;
  for (let to = found.at + 1; to < found.end; to++) {
    if (!lines[to].trimEnd().endsWith(POINTER_END)) continue;
    let from = to;
    while (from > found.at + 1 && lines[from - 1].trim()) from -= 1;
    return { heading: found.at, from, to };
  }
  return null;
}

// The edit that replaces an out-of-date pointer sentence; null when it is current or not ours to guess.
// A section that never mentions run-end was written by hand, so its sentence is left alone.
function pointerEdit(text, lines, eol) {
  const span = pointerSpan(lines);
  if (!span) return null;
  const old = lines.slice(span.from, span.to + 1);
  if (old.join(eol) === POINTER.join(eol)) return null;
  if (!old.some((l) => l.includes('skill-coach:run-end'))) return null;
  if (old.some((l) => /^\s*Hand over:/.test(l))) {
    return { error: 'a Hand over line sits inside the pointer sentence; update this skill by hand' };
  }
  // Anchor on the sentence alone; if the same text is quoted elsewhere, take the heading with it.
  for (const start of [span.from, span.heading]) {
    const oldString = lines.slice(start, span.to + 1).join(eol);
    if (occurrences(text, oldString) === 1) {
      const lead = lines.slice(start, span.from);
      return { old_string: oldString, new_string: [...lead, ...POINTER].join(eol) };
    }
  }
  return { error: 'the existing pointer sentence is not unique; update this skill by hand' };
}

// The edit that adds `shared: <folder>` as the last line of the skill-coach block, indented
// like the block's first key (a nested map or a folded value under a later key is deeper).
function sharedEdit(text, lines, eol, fmEnd, shared) {
  let at = 1;
  while (at < fmEnd && !lines[at].startsWith('skill-coach:')) at += 1;
  if (at >= fmEnd) return { error: 'no skill-coach block in the frontmatter' };
  if (lines[at].slice('skill-coach:'.length).trim()) {
    return { error: 'the skill-coach entry in the frontmatter is not a block; add the shared line by hand' };
  }
  let last = at;
  let indent = null;
  for (let i = at + 1; i < fmEnd; i++) {
    if (lines[i].trim() && !/^\s/.test(lines[i])) break;
    if (!lines[i].trim()) continue;
    last = i;
    if (indent === null) indent = /^\s*/.exec(lines[i])[0];
  }
  const line = `${indent || '  '}shared: ${yamlValue(shared)}`;
  for (let start = last; start >= 1; start--) {
    const old = lines.slice(start, last + 1).join(eol);
    if (occurrences(text, old) === 1) return { old_string: old, new_string: `${old}${eol}${line}` };
  }
  return { error: 'no unique place to add the shared line' };
}

// Apply the edits to a copy, in order, to prove each anchor still occurs exactly once.
function overlapping(text, edits) {
  let check = text;
  for (const edit of edits) {
    if (occurrences(check, edit.old_string) !== 1) return true;
    check = check.replace(edit.old_string, edit.new_string);
  }
  return false;
}

// A connected skill: only the pointer sentence and a missing `shared:` line can change; the
// rubric line and every line after the pointer (the hand-over) stay exactly as they are.
function planUpgrade(text, { lines, eol, fmEnd, shared, home }) {
  const edits = [];
  if (shared && !sharedOf(text, home)) {
    const edit = sharedEdit(text, lines, eol, fmEnd, shared);
    if (edit.error) return edit;
    edits.push(edit);
  }
  const pointer = pointerEdit(text, lines, eol);
  if (pointer && pointer.error) return pointer;
  if (pointer) edits.push(pointer);
  if (overlapping(text, edits)) return { error: 'the planned edits overlap; update this skill by hand' };
  return { state: edits.length ? 'upgrade' : 'connected', sectionMode: null, existingSection: null, edits };
}

function planConnect(text, { rubric = DEFAULT_RUBRIC, handOver = '', shared = '', home = os.homedir() } = {}) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text.endsWith(eol) ? text.slice(0, -eol.length) : text;
  const lines = body.split(eol);
  const fm = frontmatter(text);
  if (!fm) return { error: 'the skill has no frontmatter (it must start and end with a --- line)' };
  const fmEnd = fm.end;
  const family = String(shared || '').trim();
  if (/[\r\n]/.test(family)) return { error: 'the shared folder must be one line' };
  if (fm.lines.slice(1, fmEnd).some((l) => l.startsWith('skill-coach:'))) {
    return planUpgrade(text, { lines, eol, fmEnd, shared: family, home });
  }

  // Frontmatter: the shortest run of lines ending at the closing --- that occurs once.
  const block = ['skill-coach:', `  rubric: ${rubric}`, ...(family ? [`  shared: ${yamlValue(family)}`] : [])];
  let fmEdit = null;
  for (let start = fmEnd - 1; start >= 1 && !fmEdit; start--) {
    const old = lines.slice(start, fmEnd + 1).join(eol);
    if (occurrences(text, old) === 1) {
      const kept = lines.slice(start, fmEnd).join(eol);
      fmEdit = { old_string: old, new_string: [kept, ...block, lines[fmEnd]].join(eol) };
    }
  }
  if (!fmEdit) return { error: 'no unique place to add the frontmatter block' };

  const section = sectionText(eol, /^Hand over:\s*[—-]?\s*$/.test(handOver) ? '' : handOver);
  const found = findHeading(lines);
  if (found && found.error) return { error: found.error };
  let sectionEdit = null;
  let existingSection = null;
  if (found) {
    existingSection = lines.slice(found.at, found.end).join(eol);
    if (occurrences(text, existingSection) !== 1) return { error: 'the existing Self-improvement section is not unique' };
    if (existingSection !== section) sectionEdit = { old_string: existingSection, new_string: section };
  } else {
    for (let start = lines.length - 1; start > fmEnd && !sectionEdit; start--) {
      const tail = lines.slice(start).join(eol);
      if (tail.trim() && occurrences(text, tail) === 1) sectionEdit = { old_string: tail, new_string: `${tail}${eol}${eol}${section}` };
    }
    if (!sectionEdit) return { error: 'no unique place to append the Self-improvement section' };
  }

  const edits = sectionEdit ? [fmEdit, sectionEdit] : [fmEdit];
  if (overlapping(text, edits)) return { error: 'the planned edits overlap; connect this skill by hand' };
  const sectionMode = !found ? 'append' : (sectionEdit ? 'replace' : 'keep');
  return { state: 'not-connected', sectionMode, existingSection, edits };
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

// Path-like strings that start with ~/ or / — not the tail of a URL, a relative path or $HOME/….
const PATH_LIKE = /(?<![\w/:.~$}-])(?:~\/|\/)[^\s`'")\]]*/g;
// Claude Code's own folders inside a .claude folder: never a family folder, nor anything under them.
const CONFIG_FOLDERS = ['hooks', 'commands', 'agents', 'skills', 'plugins', 'projects', 'rules', 'output-styles', 'workflows'];
// A folder whose path names a secret is never offered, whatever it holds.
const SECRET_LIKE = /secret|credential|password|token/i;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// The folders of the files a SKILL.md names that exist on disk, one spelling each. A bare
// folder, an API path, a placeholder or a glob is never a file, so it never counts.
function referencedFolders(text, home) {
  const out = new Set();
  for (const [raw] of text.matchAll(PATH_LIKE)) {
    const p = raw.replace(/[.,;:]+$/, '');
    if (p.endsWith('/') || /[<>{}$*?|]/.test(p)) continue;
    const file = folder(p, home);
    if (file && isFile(file)) out.add(path.dirname(file));
  }
  return out;
}

// Folders holding files this skill's SKILL.md reads that at least one other skill's SKILL.md
// reads too — the candidates for a shared folder (`shared:`). Home, the .claude folders with
// Claude Code's own config, the data folder and any secret-like folder are never candidates.
// Read-only. `dir` pins the skill's own folder.
function sharedCandidates(skill, { home, cwd, env = process.env, dir } = {}) {
  const homeDir = path.resolve(home);
  const bases = [...new Set([home, cwd].map((r) => path.resolve(r)))];
  const roots = bases.map((r) => path.join(r, '.claude', 'skills'));
  const skills = roots.flatMap((base) => {
    let names = [];
    try { names = fs.readdirSync(base).sort(); } catch { /* no skills here */ }
    return names.map((name) => path.join(base, name)).filter((d) => fs.existsSync(path.join(d, 'SKILL.md')));
  });
  const own = dir ? path.resolve(dir) : skills.find((d) => path.basename(d) === skill);
  if (!own) return [];
  const read = (d) => referencedFolders(fs.readFileSync(path.join(d, 'SKILL.md'), 'utf8'), homeDir);

  const under = (p, base) => p === base || p.startsWith(`${base}/`);
  const shown = (f) => (under(f, homeDir) ? `~${f.slice(homeDir.length)}` : f);
  const claudes = bases.map((r) => path.join(r, '.claude'));
  const never = [own, ...roots, path.join(homeDir, '.claude', 'self-improvement'), dataDir({ ...env, HOME: homeDir }),
    ...claudes.flatMap((c) => CONFIG_FOLDERS.map((name) => path.join(c, name)))];
  const tooBroad = new Set(['/', homeDir, ...claudes]);
  const safe = (f) => !tooBroad.has(f) && !never.some((base) => under(f, base)) && !SECRET_LIKE.test(shown(f));
  const mine = [...read(own)].filter(safe);

  const others = new Set();
  for (const d of skills.filter((d) => path.resolve(d) !== own)) {
    try { read(d).forEach((f) => others.add(f)); } catch { /* unreadable skill */ }
  }
  return mine.filter((f) => others.has(f)).map(shown).sort();
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
  // Prefer --hand-over-file: a shell argument would expand backticks and $ in the line.
  const handFile = opt('--hand-over-file');
  const handOver = handFile ? fs.readFileSync(handFile, 'utf8').replace(/\s+$/, '') : (opt('--hand-over') || '');
  const plan = planConnect(text, { rubric: opt('--rubric') || DEFAULT_RUBRIC, handOver, shared: opt('--shared') || '', home });
  if (plan.error) return { ok: false, reason: plan.error, file: where.file };
  const rel = plan.state === 'not-connected' ? (opt('--rubric') || DEFAULT_RUBRIC) : (rubricOf(text) || DEFAULT_RUBRIC);
  // A skill that already names a shared folder has nothing to be offered.
  const candidates = sharedOf(text, home) ? [] : sharedCandidates(name, { home, cwd, env, dir: where.dir });
  const rubricPath = path.join(where.dir, rel);
  return {
    ok: true, skill: name, root: where.root, file: where.file, warning: where.warning,
    state: plan.state, hookConnected: isConnected(name, cwd, home),
    sectionMode: plan.sectionMode, existingSection: plan.existingSection,
    rubric: { path: rubricPath, exists: fs.existsSync(rubricPath) }, shared_candidates: candidates, edits: plan.edits,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(main(process.argv.slice(2), process.env), null, 2) + '\n');
}

module.exports = { planConnect, findSkill, listSkills, sharedCandidates };
