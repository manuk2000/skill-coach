const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planConnect, findSkill, listSkills } = require('../scripts/connect-plan.js');
const { isConnected } = require('../scripts/log-run.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'connect-plan.js');
const PLAIN = '---\nname: demo-skill\ndescription: Does a demo.\n---\n\n# Demo\n\nStep one.\n\n## Usage\n\nRun it.\n';

function applyEdit(text, edit) {
  assert.equal(text.split(edit.old_string).length - 1, 1, `old_string must occur once: ${JSON.stringify(edit.old_string)}`);
  return text.replace(edit.old_string, edit.new_string);
}
const applyAll = (text, plan) => plan.edits.reduce(applyEdit, text);
const frontmatterOf = (text) => text.split(/\r?\n---\r?\n/)[0];

function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-connect-'));
  const project = path.join(h, 'project');
  fs.mkdirSync(project, { recursive: true });
  const put = (root, name, text) => {
    fs.mkdirSync(path.join(root, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', name, 'SKILL.md'), text);
  };
  return { h, project, put };
}

test('a plain skill gets the frontmatter block and an appended section', () => {
  const plan = planConnect(PLAIN, { handOver: 'Hand over: the self-check line.' });
  assert.equal(plan.state, 'not-connected');
  assert.equal(plan.sectionMode, 'append');
  const after = applyAll(PLAIN, plan);
  assert.match(frontmatterOf(after), /\nskill-coach:\n {2}rubric: references\/rubric\.md$/);
  assert.match(after, /\n## Self-improvement\n\nAt the end of every run[\s\S]*skill-coach:run-end[\s\S]*Hand over: the self-check line\.\n$/);
  assert.ok(after.includes('## Usage\n\nRun it.\n\n## Self-improvement'));
});

test('an existing Self-improvement section is replaced and returned', () => {
  const text = `${PLAIN}\n## Self-improvement\n\nOld words.\n\n## Later\n\nKeep me.\n`;
  const plan = planConnect(text, {});
  assert.equal(plan.sectionMode, 'replace');
  assert.equal(plan.existingSection, '## Self-improvement\n\nOld words.');
  const after = applyAll(text, plan);
  assert.ok(!after.includes('Old words.'));
  assert.ok(after.includes('## Later\n\nKeep me.'));
});

test('a Self-improvement heading inside a code block is ignored', () => {
  const text = `${PLAIN}\n\`\`\`markdown\n## Self-improvement\n\nTemplate.\n\`\`\`\n`;
  const plan = planConnect(text, {});
  assert.equal(plan.sectionMode, 'append');
  assert.ok(applyAll(text, plan).includes('Template.'));
});

test('an already connected skill gets no edits', () => {
  const text = PLAIN.replace('---\n\n# Demo', 'skill-coach:\n  rubric: references/rubric.md\n---\n\n# Demo');
  const plan = planConnect(text, {});
  assert.equal(plan.state, 'connected');
  assert.deepEqual(plan.edits, []);
});

test('Windows line endings are kept', () => {
  const text = PLAIN.replace(/\n/g, '\r\n');
  const after = applyAll(text, planConnect(text, {}));
  assert.ok(!/[^\r]\n/.test(after), 'every newline stays CRLF');
  assert.match(after, /\r\nskill-coach:\r\n {2}rubric: references\/rubric\.md\r\n---\r\n/);
});

test('a file without frontmatter is refused', () => {
  assert.match(planConnect('# No frontmatter\n', {}).error, /frontmatter/);
});

test('a repeated last line still gives a unique anchor', () => {
  const text = `${PLAIN}\nDone.\n\n## Again\n\nDone.\n`;
  const after = applyAll(text, planConnect(text, {}));
  assert.ok(after.trimEnd().endsWith('folder, not here.'));
  assert.equal(after.split('Done.').length - 1, 2);
});

test('a custom rubric path is written into the block', () => {
  const after = applyAll(PLAIN, planConnect(PLAIN, { rubric: 'RUBRIC.md' }));
  assert.match(frontmatterOf(after), /rubric: RUBRIC\.md$/);
});

test('the result passes the hook\'s connection test', () => {
  const t = home();
  t.put(t.h, 'demo-skill', applyAll(PLAIN, planConnect(PLAIN, {})));
  assert.equal(isConnected('demo-skill', t.project, t.h), true);
});

test('findSkill refuses plugin skills and reports both locations', () => {
  const t = home();
  assert.match(findSkill('other-plugin:tool', { home: t.h, cwd: t.project }).error, /plugin/);
  t.put(t.h, 'demo-skill', PLAIN);
  t.put(t.project, 'demo-skill', PLAIN);
  const both = findSkill('demo-skill', { home: t.h, cwd: t.project });
  assert.match(both.error, /both/);
  const picked = findSkill('demo-skill', { home: t.h, cwd: t.project, root: 'project' });
  assert.equal(picked.root, 'project');
  assert.match(picked.warning, /git/);
  assert.match(findSkill('missing-skill', { home: t.h, cwd: t.project }).error, /not found/);
});

test('listSkills shows unconnected skills, most used first', () => {
  const t = home();
  t.put(t.h, 'used-a-lot', PLAIN);
  t.put(t.h, 'used-once', PLAIN);
  t.put(t.h, 'already-on', applyAll(PLAIN, planConnect(PLAIN, {})));
  const ledger = path.join(t.h, 'ledger.jsonl');
  const rows = ['used-a-lot', 'used-a-lot', 'used-a-lot', 'used-once', 'already-on'].map((skill) => JSON.stringify({ type: 'run', skill }));
  fs.writeFileSync(ledger, rows.join('\n') + '\n');
  const list = listSkills({ home: t.h, cwd: t.project, ledger });
  assert.deepEqual(list.map((s) => [s.skill, s.connected, s.runs]), [
    ['used-a-lot', false, 3], ['used-once', false, 1], ['already-on', true, 1]]);
});

test('a byte-order mark and a padded closer still connect where the hook looks', () => {
  const t = home();
  const bom = `﻿${PLAIN}`;
  t.put(t.h, 'bom-skill', applyAll(bom, planConnect(bom, {})));
  assert.equal(isConnected('bom-skill', t.project, t.h), true);
  const padded = '---\nname: pad-skill\n--- \n\n# Pad\n\nStep.\n\n---\n\nMore.\n';
  const after = applyAll(padded, planConnect(padded, {}));
  assert.match(after, /^---\nname: pad-skill\nskill-coach:\n {2}rubric: references\/rubric\.md\n--- \n/);
  t.put(t.h, 'pad-skill', after);
  assert.equal(isConnected('pad-skill', t.project, t.h), true);
});

test('fences of four backticks or tildes hide a template heading', () => {
  for (const fence of ['````', '~~~']) {
    const text = `${PLAIN}\n${fence}markdown\n\`\`\`yaml\nx: 1\n## Self-improvement\n\nTemplate.\n\`\`\`\n${fence}\n`;
    const plan = planConnect(text, {});
    assert.equal(plan.sectionMode, 'append', fence);
    assert.ok(applyAll(text, plan).includes(`Template.\n\`\`\`\n${fence}\n`), fence);
  }
});

test('only a real Self-improvement heading counts, and two of them are refused', () => {
  const loop = `${PLAIN}\n## Self-improvement-loop design\n\nNotes.\n`;
  assert.equal(planConnect(loop, {}).sectionMode, 'append');
  const wiring = `${PLAIN}\n## Self-improvement wiring\n\nHow to wire.\n\n## Self-improvement (offer, never silent)\n\nOld.\n`;
  const w = planConnect(wiring, {});
  assert.equal(w.sectionMode, 'replace');
  assert.equal(w.existingSection, '## Self-improvement (offer, never silent)\n\nOld.');
  const two = `${PLAIN}\n## Self-improvement\n\nA.\n\n## Self-improvement\n\nB.\n`;
  assert.match(planConnect(two, {}).error, /several/);
});

test('a following top-level heading is not swallowed', () => {
  const text = `${PLAIN}\n## Self-improvement\n\nOld.\n\n# Appendix\n\nKeep.\n`;
  const after = applyAll(text, planConnect(text, {}));
  assert.ok(after.includes('# Appendix\n\nKeep.'));
  assert.ok(!after.includes('Old.'));
});

test('an identical existing section is kept and only the frontmatter changes', () => {
  const pointer = planConnect(PLAIN, {}).edits[1].new_string.replace(/^[\s\S]*?\n\n## Self-improvement/, '## Self-improvement');
  const text = `${PLAIN}\n${pointer}\n`;
  const plan = planConnect(text, {});
  assert.equal(plan.sectionMode, 'keep');
  assert.equal(plan.edits.length, 1);
  assert.ok(plan.edits[0].new_string.includes('skill-coach:'));
});

test('CLI reads the hand-over line from a file and reports the hook view', () => {
  const t = home();
  t.put(t.h, 'demo-skill', PLAIN);
  const hand = path.join(t.h, 'hand-over.txt');
  fs.writeFileSync(hand, 'Hand over: the `date +%Y` line and the $HOME check\n');
  const r = spawnSync(process.execPath, [SCRIPT, '--skill', 'demo-skill', '--cwd', t.project, '--hand-over-file', hand],
    { env: { ...process.env, HOME: t.h, SKILL_COACH_DATA: path.join(t.h, 'data') }, encoding: 'utf8' });
  const plan = JSON.parse(r.stdout);
  assert.ok(plan.edits[1].new_string.endsWith('Hand over: the `date +%Y` line and the $HOME check'));
  assert.equal(plan.hookConnected, false);
});

test('CLI prints a plan for a skill', () => {
  const t = home();
  t.put(t.h, 'demo-skill', PLAIN);
  const r = spawnSync(process.execPath, [SCRIPT, '--skill', 'demo-skill', '--cwd', t.project],
    { env: { ...process.env, HOME: t.h, SKILL_COACH_DATA: path.join(t.h, 'data') }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'not-connected');
  assert.equal(plan.rubric.exists, false);
  assert.equal(plan.edits.length, 2);
});
