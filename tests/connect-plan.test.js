const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planConnect, findSkill, listSkills, sharedCandidates } = require('../scripts/connect-plan.js');
const { isConnected } = require('../scripts/log-run.js');
const { sharedOf } = require('../scripts/family.js');

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
  assert.ok(after.trimEnd().endsWith('Settings live in the skill-coach data folder, not here.'));
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

const NEW_POINTER = [
  "At the end of every run — and again if the user's next message corrects the",
  'result or asks to add something to the skill — invoke `skill-coach:run-end`.',
  'Settings live in the skill-coach data folder, not here.',
].join('\n');
const OLD_POINTER = [
  "At the end of every run — and again if the user's next message corrects the",
  'result — invoke `skill-coach:run-end`. Settings live in the skill-coach data',
  'folder, not here.',
].join('\n');
const HAND_OVER = 'Hand over: the `date +%Y` line and the $HOME check.';
// A skill connected by v0.1: the old pointer sentence, then a hand-over line, then more skill text.
const OLD_CONNECTED = PLAIN.replace('---\n\n# Demo', 'skill-coach:\n  rubric: RUBRIC.md\n---\n\n# Demo')
  + `\n## Self-improvement\n\n${OLD_POINTER}\n\n${HAND_OVER}\n\n## Later\n\nKeep me.\n`;

test('the pointer names corrections and requests', () => {
  const after = applyAll(PLAIN, planConnect(PLAIN, {}));
  assert.ok(after.includes(`## Self-improvement\n\n${NEW_POINTER}\n`), 'the section holds the new sentence verbatim');
  assert.ok(!after.includes('result — invoke'), 'the old wording is gone');
});

test('an old pointer is upgraded and the hand-over kept', () => {
  const plan = planConnect(OLD_CONNECTED, {});
  assert.equal(plan.state, 'upgrade');
  assert.equal(plan.edits.length, 1);
  assert.deepEqual(plan.edits[0], { old_string: OLD_POINTER, new_string: NEW_POINTER });
  const after = applyAll(OLD_CONNECTED, plan);
  assert.equal(after, OLD_CONNECTED.replace(OLD_POINTER, NEW_POINTER));
  assert.ok(after.includes(`${NEW_POINTER}\n\n${HAND_OVER}\n\n## Later\n\nKeep me.\n`), 'hand-over and the next section are untouched');
  assert.match(frontmatterOf(after), /\nskill-coach:\n {2}rubric: RUBRIC\.md$/);
  assert.equal(planConnect(after, {}).state, 'connected', 'a second pass has nothing to do');
});

test('an upgrade keeps Windows line endings', () => {
  const text = OLD_CONNECTED.replace(/\n/g, '\r\n');
  const plan = planConnect(text, { shared: '~/.claude/demo-shared' });
  assert.equal(plan.state, 'upgrade');
  assert.equal(plan.edits.length, 2);
  const after = applyAll(text, plan);
  assert.ok(!/[^\r]\n/.test(after), 'every newline stays CRLF');
  assert.match(after, /\r\n {2}rubric: RUBRIC\.md\r\n {2}shared: ~\/\.claude\/demo-shared\r\n---\r\n/);
  assert.ok(after.includes(NEW_POINTER.replace(/\n/g, '\r\n')));
});

test('a connected skill with the current pointer has nothing to do', () => {
  const fresh = applyAll(PLAIN, planConnect(PLAIN, { handOver: HAND_OVER }));
  const plan = planConnect(fresh, {});
  assert.equal(plan.state, 'connected');
  assert.deepEqual(plan.edits, []);
});

test('a hand-connected section without the closing line is left alone', () => {
  const text = PLAIN.replace('---\n\n# Demo', 'skill-coach:\n  rubric: RUBRIC.md\n---\n\n# Demo')
    + '\n## Self-improvement\n\nInvoke skill-coach:run-end when done.\n';
  const plan = planConnect(text, {});
  assert.equal(plan.state, 'connected');
  assert.deepEqual(plan.edits, []);
  assert.equal(planConnect(PLAIN.replace('---\n\n# Demo', 'skill-coach:\n  rubric: RUBRIC.md\n---\n\n# Demo'), {}).state, 'connected', 'no section at all is also left alone');
});

test('a hand-written section without run-end is not rewritten', () => {
  const text = PLAIN.replace('---\n\n# Demo', 'skill-coach:\n  rubric: RUBRIC.md\n---\n\n# Demo')
    + '\n## Self-improvement\n\nWhen the run ends, write the notes to the usual file.\nThe rules for it are kept elsewhere, not here.\n\n## Later\n\nKeep me.\n';
  const plan = planConnect(text, {});
  assert.equal(plan.state, 'connected');
  assert.deepEqual(plan.edits, []);
  const withFamily = planConnect(text, { shared: '~/.claude/demo-shared' });
  assert.equal(withFamily.state, 'upgrade');
  assert.equal(withFamily.edits.length, 1, 'only the shared line is planned, never the pointer');
  assert.ok(withFamily.edits[0].new_string.includes('shared: ~/.claude/demo-shared'));
});

test('an upgrade finds the pointer when the same sentence is quoted elsewhere', () => {
  const text = `${OLD_CONNECTED}\n\`\`\`markdown\n${OLD_POINTER}\n\`\`\`\n`;
  const plan = planConnect(text, {});
  assert.equal(plan.state, 'upgrade');
  assert.ok(plan.edits[0].old_string.startsWith('## Self-improvement\n\n'), 'anchored on the heading');
  const after = applyAll(text, plan);
  assert.ok(after.includes(`## Self-improvement\n\n${NEW_POINTER}\n\n${HAND_OVER}`));
  assert.ok(after.endsWith(`${OLD_POINTER}\n\`\`\`\n`), 'the quoted copy is untouched');
});

test('an upgrade with no unique anchor is refused, not guessed', () => {
  const text = `${OLD_CONNECTED}\n\`\`\`markdown\n## Self-improvement\n\n${OLD_POINTER}\n\`\`\`\n`;
  assert.match(planConnect(text, {}).error, /not unique/);
});

test('shared is written under skill-coach', () => {
  const t = home();
  const plan = planConnect(PLAIN, { shared: '~/.claude/demo-shared' });
  assert.equal(plan.state, 'not-connected');
  const after = applyAll(PLAIN, plan);
  assert.match(frontmatterOf(after), /\nskill-coach:\n {2}rubric: references\/rubric\.md\n {2}shared: ~\/\.claude\/demo-shared$/);
  assert.equal(sharedOf(after, t.h), path.join(t.h, '.claude', 'demo-shared'));
  t.put(t.h, 'demo-skill', after);
  assert.equal(isConnected('demo-skill', t.project, t.h), true);
  assert.ok(!applyAll(PLAIN, planConnect(PLAIN, {})).includes('shared:'), 'no shared line unless asked');
});

test('shared is added to a connected skill as an upgrade', () => {
  const t = home();
  const fresh = applyAll(PLAIN, planConnect(PLAIN, { handOver: HAND_OVER }));
  const plan = planConnect(fresh, { shared: '~/.claude/demo-shared/' });
  assert.equal(plan.state, 'upgrade');
  assert.equal(plan.edits.length, 1);
  const after = applyAll(fresh, plan);
  assert.match(frontmatterOf(after), /\nskill-coach:\n {2}rubric: references\/rubric\.md\n {2}shared: ~\/\.claude\/demo-shared\/$/);
  assert.equal(after.replace('  shared: ~/.claude/demo-shared/\n', ''), fresh, 'nothing else changed');
  assert.equal(sharedOf(after, t.h), path.join(t.h, '.claude', 'demo-shared'));
  assert.equal(planConnect(after, { shared: '~/.claude/demo-shared' }).state, 'connected', 'never added twice');
  assert.equal(planConnect(after, { shared: '~/.claude/other-shared' }).state, 'connected', 'an existing family is not replaced');
});

test('an old pointer and a missing shared line upgrade together', () => {
  const plan = planConnect(OLD_CONNECTED, { shared: '~/.claude/demo-shared' });
  assert.equal(plan.state, 'upgrade');
  assert.equal(plan.edits.length, 2);
  const after = applyAll(OLD_CONNECTED, plan);
  assert.match(frontmatterOf(after), /rubric: RUBRIC\.md\n {2}shared: ~\/\.claude\/demo-shared$/);
  assert.ok(after.includes(`${NEW_POINTER}\n\n${HAND_OVER}\n\n## Later`));
});

test('a shared line is not added to a one-line skill-coach entry or a multi-line value', () => {
  const inline = PLAIN.replace('---\n\n# Demo', 'skill-coach: {rubric: x.md}\n---\n\n# Demo');
  assert.match(planConnect(inline, { shared: '~/.claude/demo-shared' }).error, /by hand/);
  assert.match(planConnect(PLAIN, { shared: '~/a\nname: x' }).error, /one line/);
});

// Skills for the shared-candidate tests; `body` is the SKILL.md text after the frontmatter.
const skillWith = (name, body) => `---\nname: ${name}\ndescription: Does a demo.\n---\n\n# ${name}\n\n${body}\n`;

test('a folder two skills read is a shared candidate', () => {
  const t = home();
  t.put(t.h, 'demo-a', skillWith('demo-a', 'Read `~/.claude/demo-shared/notes.md` first, then see ~/.claude/demo-shared/.'));
  t.put(t.h, 'demo-b', skillWith('demo-b', `Look in "${t.h}/.claude/demo-shared/style.md".`));
  t.put(t.project, 'demo-c', skillWith('demo-c', 'Nothing shared here.'));
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project }), ['~/.claude/demo-shared']);
  assert.deepEqual(sharedCandidates('demo-b', { home: t.h, cwd: t.project }), ['~/.claude/demo-shared']);
  assert.deepEqual(sharedCandidates('demo-c', { home: t.h, cwd: t.project }), []);
});

test('a project skill and a user skill can share a folder; results are sorted and unique', () => {
  const t = home();
  t.put(t.h, 'demo-a', skillWith('demo-a', 'Uses ~/.claude/zeta-shared/a.md, ~/.claude/zeta-shared/b.md and (~/.claude/alpha-shared).'));
  t.put(t.project, 'demo-b', skillWith('demo-b', 'Uses [x](~/.claude/alpha-shared/x.md) and ~/.claude/zeta-shared/c.md;'));
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project }), ['~/.claude/alpha-shared', '~/.claude/zeta-shared']);
});

test('a folder only one skill reads is not a candidate', () => {
  const t = home();
  t.put(t.h, 'demo-a', skillWith('demo-a', 'Read ~/.claude/demo-shared/notes.md and ~/.claude/only-mine/x.md.'));
  t.put(t.h, 'demo-b', skillWith('demo-b', 'Read ~/.claude/demo-shared/notes.md and ~/.claude/only-theirs/y.md.'));
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project }), ['~/.claude/demo-shared']);
  assert.deepEqual(sharedCandidates('lone-skill', { home: t.h, cwd: t.project }), [], 'an unknown skill has none');
});

test('skills, data and plugin folders are never candidates', () => {
  const t = home();
  const data = path.join(t.h, 'elsewhere', 'coach-data');
  const body = [
    'See ~/.claude/skills/demo-b/references/x.md and ~/.claude/skills.',
    'Notes: ~/.claude/self-improvement/ledger.jsonl and ' + data + '/changes.md.',
    'Plugins: ~/.claude/plugins/cache/p/README.md and ~/.claude/plugins.',
    'Broad: ~/.claude, ~/, ~/notes.md, / and /readme.md.',
    `Own: ${t.project}/.claude/skills/demo-a/references/rubric.md.`,
  ].join('\n');
  t.put(t.h, 'demo-a', skillWith('demo-a', body));
  t.put(t.h, 'demo-b', skillWith('demo-b', body));
  t.put(t.project, 'demo-a', skillWith('demo-a', body));
  const env = { HOME: t.h, SKILL_COACH_DATA: data };
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project, env }), []);
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project, env: { HOME: t.h } }), [`~/elsewhere/coach-data`], 'only the data folder in use is excluded, beyond the default one');
});

test('URLs, slash commands and relative paths are not folders', () => {
  const t = home();
  const body = 'Run /skill-coach:connect or /clear, see https://example.test/docs/page and ${HOME}/a/b, also refs/rubric.md, ./x/y and a/b/c.';
  t.put(t.h, 'demo-a', skillWith('demo-a', body));
  t.put(t.h, 'demo-b', skillWith('demo-b', body));
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project }), []);
});

test('a placeholder or glob cuts the path back to the folder before it', () => {
  const t = home();
  const body = 'Use ~/.claude/demo-shared/<name>.md, ~/.claude/demo-shared/*.md, ~/.claude/demo-glob/{a,b}.md and /srv/<repo>/x.';
  t.put(t.h, 'demo-a', skillWith('demo-a', body));
  t.put(t.h, 'demo-b', skillWith('demo-b', 'Use ~/.claude/demo-shared/ and ~/.claude/demo-glob/ here.'));
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project }), ['~/.claude/demo-glob', '~/.claude/demo-shared']);
});

test('an absolute folder outside home keeps its absolute form', () => {
  const t = home();
  t.put(t.h, 'demo-a', skillWith('demo-a', 'Mount: /srv/demo-shared/notes.md'));
  t.put(t.h, 'demo-b', skillWith('demo-b', 'Mount: `/srv/demo-shared/`.'));
  assert.deepEqual(sharedCandidates('demo-a', { home: t.h, cwd: t.project }), ['/srv/demo-shared']);
});

test('CLI passes --shared through and lists shared candidates', () => {
  const t = home();
  const skillFile = path.join(t.h, '.claude', 'skills', 'demo-skill', 'SKILL.md');
  const run = (...args) => JSON.parse(spawnSync(process.execPath, [SCRIPT, '--skill', 'demo-skill', '--cwd', t.project, ...args],
    { env: { ...process.env, HOME: t.h, SKILL_COACH_DATA: path.join(t.h, 'data') }, encoding: 'utf8' }).stdout);
  t.put(t.h, 'demo-skill', skillWith('demo-skill', 'Reads ~/.claude/demo-shared/notes.md.'));
  t.put(t.h, 'demo-b', skillWith('demo-b', 'Reads ~/.claude/demo-shared/style.md.'));

  const first = run();
  assert.deepEqual(first.shared_candidates, ['~/.claude/demo-shared']);
  assert.ok(!first.edits[0].new_string.includes('shared:'));
  const second = run('--shared', '~/.claude/demo-shared');
  assert.match(second.edits[0].new_string, /\n {2}rubric: references\/rubric\.md\n {2}shared: ~\/\.claude\/demo-shared\n---$/);
  fs.writeFileSync(skillFile, applyAll(fs.readFileSync(skillFile, 'utf8'), second));
  const third = run('--shared', '~/.claude/demo-shared');
  assert.equal(third.state, 'connected');
  assert.deepEqual(third.shared_candidates, [], 'a skill that already has a family is offered none');

  // A skill connected by an older version: new pointer and the family line, in one plan.
  const old = skillWith('demo-skill', 'Reads ~/.claude/demo-shared/notes.md.')
    .replace('---\n\n# demo-skill', 'skill-coach:\n  rubric: references/rubric.md\n---\n\n# demo-skill')
    + `\n## Self-improvement\n\n${OLD_POINTER}\n`;
  fs.writeFileSync(skillFile, old);
  const upgrade = run('--shared', '~/.claude/demo-shared');
  assert.equal(upgrade.state, 'upgrade');
  assert.equal(upgrade.edits.length, 2);
  assert.equal(upgrade.rubric.path, path.join(t.h, '.claude', 'skills', 'demo-skill', 'references', 'rubric.md'));
  assert.deepEqual(upgrade.shared_candidates, ['~/.claude/demo-shared']);
});
