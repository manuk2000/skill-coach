const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sharedOf, familyOf } = require('../scripts/family.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'family.js');

const skillText = (name, shared) => `---\nname: ${name}\nskill-coach:\n  rubric: references/rubric.md\n${shared ? `  shared: ${shared}\n` : ''}---\n# ${name}\n`;

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-fam-'));
  const project = path.join(home, 'project');
  fs.mkdirSync(project, { recursive: true });
  const writeSkill = (root, name, text) => {
    fs.mkdirSync(path.join(root, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', name, 'SKILL.md'), text);
  };
  return { home, project, writeSkill };
}

test('sharedOf reads the shared line and expands ~', () => {
  assert.equal(sharedOf(skillText('demo-a', '~/.claude/release-notes-data'), '/home/u'), '/home/u/.claude/release-notes-data');
  assert.equal(sharedOf(skillText('demo-a', '/srv/release-notes-data'), '/home/u'), '/srv/release-notes-data');
  assert.equal(sharedOf(skillText('demo-a', '"~/release notes"'), '/home/u'), '/home/u/release notes');
  assert.equal(sharedOf(skillText('demo-a'), '/home/u'), null);
  assert.equal(sharedOf('# no frontmatter\nshared: /x\n', '/home/u'), null);
});

test('a skill without shared has no family', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-a', skillText('demo-a'));
  assert.deepEqual(familyOf('demo-a', { home: s.home, cwd: s.project }), { shared: null, members: [] });
  assert.deepEqual(familyOf('missing-skill', { home: s.home, cwd: s.project }), { shared: null, members: [] });
});

test('two skills naming the same folder are one family', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-b', skillText('demo-b', '~/.claude/release-notes-data'));
  s.writeSkill(s.home, 'demo-a', skillText('demo-a', '~/.claude/release-notes-data'));
  s.writeSkill(s.home, 'demo-other', skillText('demo-other', '~/.claude/elsewhere'));
  const fam = familyOf('demo-b', { home: s.home, cwd: s.project });
  assert.equal(fam.shared, path.join(s.home, '.claude', 'release-notes-data'));
  assert.deepEqual(fam.members.map((m) => m.skill), ['demo-a', 'demo-b']);
  assert.equal(fam.members[0].skill_dir, path.join(s.home, '.claude', 'skills', 'demo-a'));
});

test('a project skill joins the family of a user skill', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-a', skillText('demo-a', '~/.claude/release-notes-data'));
  s.writeSkill(s.project, 'demo-b', skillText('demo-b', `${s.home}/.claude/release-notes-data`));
  const fam = familyOf('demo-a', { home: s.home, cwd: s.project });
  assert.deepEqual(fam.members.map((m) => m.skill), ['demo-a', 'demo-b']);
  assert.equal(fam.members[1].skill_dir, path.join(s.project, '.claude', 'skills', 'demo-b'));
});

test('a trailing slash or ~ does not split a family', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-a', skillText('demo-a', '~/.claude/release-notes-data/'));
  s.writeSkill(s.home, 'demo-b', skillText('demo-b', `${s.home}/.claude/release-notes-data`));
  s.writeSkill(s.home, 'demo-c', skillText('demo-c', '~/.claude/release-notes-data//'));
  const fam = familyOf('demo-a', { home: s.home, cwd: s.project });
  assert.deepEqual(fam.members.map((m) => m.skill), ['demo-a', 'demo-b', 'demo-c']);
  assert.ok(!fam.shared.endsWith('/'));
});

test('an unconnected skill with shared: is not a member', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-a', skillText('demo-a', '~/.claude/release-notes-data'));
  s.writeSkill(s.home, 'demo-c', '---\nname: demo-c\nshared: ~/.claude/release-notes-data\n---\n# demo-c\n');
  assert.deepEqual(familyOf('demo-a', { home: s.home, cwd: s.project }).members.map((m) => m.skill), ['demo-a']);
  assert.deepEqual(familyOf('demo-c', { home: s.home, cwd: s.project }), { shared: null, members: [] });
});

test('CLI prints the family', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-a', skillText('demo-a', '~/.claude/release-notes-data'));
  s.writeSkill(s.project, 'demo-b', skillText('demo-b', '~/.claude/release-notes-data'));
  const r = spawnSync(process.execPath, [SCRIPT, '--skill', 'demo-a', '--cwd', s.project], { env: { ...process.env, HOME: s.home }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.shared, path.join(s.home, '.claude', 'release-notes-data'));
  assert.deepEqual(out.members.map((m) => m.skill), ['demo-a', 'demo-b']);
});

test('CLI reports a missing skill name', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).error);
});
