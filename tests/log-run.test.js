const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { main, isConnected, countRuns, dataDir } = require('../scripts/log-run.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'log-run.js');
const FIX = path.join(__dirname, 'fixtures');
const NOW = new Date('2026-10-19T12:00:00.000Z');
const CONNECTED = '---\nname: demo-skill\nskill-coach:\n  rubric: references/rubric.md\n---\n# Demo\n';

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-home-'));
  const project = path.join(home, 'project');
  fs.mkdirSync(project, { recursive: true });
  const env = { HOME: home, SKILL_COACH_DATA: path.join(home, 'data') };
  const ledger = path.join(env.SKILL_COACH_DATA, 'ledger.jsonl');
  const readLedger = () => (fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
  const event = (file, extra = {}) => JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8')), cwd: project, ...extra });
  const writeSkill = (root, name, text) => {
    fs.mkdirSync(path.join(root, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', name, 'SKILL.md'), text);
  };
  const seed = (skill, count) => {
    fs.mkdirSync(env.SKILL_COACH_DATA, { recursive: true });
    const rows = Array.from({ length: count }, (_, i) => JSON.stringify({ type: 'run', skill, n: i + 1 }));
    fs.appendFileSync(ledger, rows.join('\n') + '\n');
  };
  return { home, project, env, ledger, readLedger, event, writeSkill, seed };
}

test('dataDir prefers SKILL_COACH_DATA, else ~/.claude/self-improvement', () => {
  assert.equal(dataDir({ SKILL_COACH_DATA: '/x/y' }), '/x/y');
  assert.equal(dataDir({ HOME: '/home/u' }), path.join('/home/u', '.claude', 'self-improvement'));
});

test('tool event appends one run line', () => {
  const s = setup();
  const r = main('tool', s.event('event-pretooluse-skill.json'), s.env, NOW);
  assert.deepEqual(Object.keys(r.line), ['type', 'time', 'session', 'transcript', 'cwd', 'skill', 'via', 'n']);
  assert.equal(r.line.type, 'run');
  assert.equal(r.line.time, NOW.toISOString());
  assert.equal(r.line.skill, 'demo-skill');
  assert.equal(r.line.via, 'tool');
  assert.equal(r.line.n, 1);
  assert.equal(r.line.session, '00000000-0000-0000-0000-000000000000');
  assert.equal(s.readLedger().length, 1);
  assert.equal(r.output, null);
});

test('a subagent event points at the subagent transcript', () => {
  const s = setup();
  const r = main('tool', s.event('event-pretooluse-skill-subagent.json'), s.env, NOW);
  assert.equal(r.line.agent, 'a0000000000000001');
  assert.equal(r.line.transcript, path.join(
    '/home/user/.claude/projects/-home-user-project',
    '00000000-0000-0000-0000-000000000000', 'subagents', 'agent-a0000000000000001.jsonl'));
});

test('typed command strips arguments', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', '# Demo\n');
  const r = main('typed', s.event('event-userpromptsubmit-typed.json'), s.env, NOW);
  assert.equal(r.line.skill, 'demo-skill');
  assert.equal(r.line.via, 'typed');
});

test('typed command resolves a commands file', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.home, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(s.home, '.claude', 'commands', 'demo-cmd.md'), '# cmd\n');
  const r = main('typed', s.event('event-userpromptsubmit-typed.json', { prompt: '/demo-cmd' }), s.env, NOW);
  assert.equal(r.line.skill, 'demo-cmd');
});

test('typed plugin command keeps its prefix', () => {
  const s = setup();
  const r = main('typed', s.event('event-userpromptsubmit-typed.json', { prompt: '/other-plugin:tool x' }), s.env, NOW);
  assert.equal(r.line.skill, 'other-plugin:tool');
});

test('built-in typed command writes nothing', () => {
  const s = setup();
  const r = main('typed', s.event('event-userpromptsubmit-typed.json', { prompt: '/clear' }), s.env, NOW);
  assert.deepEqual(r, { line: null, output: null });
  assert.equal(s.readLedger().length, 0);
});

test('plain text prompt writes nothing', () => {
  const s = setup();
  const r = main('typed', s.event('event-userpromptsubmit-typed.json', { prompt: 'hello there' }), s.env, NOW);
  assert.deepEqual(r, { line: null, output: null });
});

test('10th run of a connected skill prints the spot check', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', CONNECTED);
  s.seed('demo-skill', 9);
  s.seed('other-skill', 4);
  const r = main('tool', s.event('event-pretooluse-skill.json'), s.env, NOW);
  assert.equal(r.line.n, 10);
  const out = JSON.parse(r.output).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.match(out.additionalContext, /spot check due for demo-skill/);
});

test('a typed spot check uses the UserPromptSubmit event name', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', CONNECTED);
  s.seed('demo-skill', 19);
  const r = main('typed', s.event('event-userpromptsubmit-typed.json'), s.env, NOW);
  assert.equal(r.line.n, 20);
  assert.equal(JSON.parse(r.output).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});

test('10th run of an unconnected skill prints nothing', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', '---\nname: demo-skill\n---\n# Demo\n');
  s.seed('demo-skill', 9);
  const r = main('tool', s.event('event-pretooluse-skill.json'), s.env, NOW);
  assert.equal(r.line.n, 10);
  assert.equal(r.output, null);
});

test('isConnected reads CRLF frontmatter and ignores files without frontmatter', () => {
  const s = setup();
  s.writeSkill(s.home, 'crlf-skill', '---\r\nname: crlf-skill\r\nskill-coach:\r\n  rubric: references/rubric.md\r\n---\r\n# Demo\r\n');
  s.writeSkill(s.home, 'plain-skill', '# Demo\nskill-coach:\n  rubric: x\n');
  assert.equal(isConnected('crlf-skill', s.project, s.home), true);
  assert.equal(isConnected('plain-skill', s.project, s.home), false);
});

test('isConnected looks in the project skills folder too', () => {
  const s = setup();
  s.writeSkill(s.project, 'project-skill', CONNECTED);
  assert.equal(isConnected('project-skill', s.project, s.home), true);
  assert.equal(isConnected('missing-skill', s.project, s.home), false);
});

test('plugin skills are never connected', () => {
  const s = setup();
  assert.equal(isConnected('other-plugin:tool', s.project, s.home), false);
});

test('countRuns counts one skill and skips bad lines', () => {
  const s = setup();
  s.seed('demo-skill', 3);
  s.seed('other-skill', 2);
  fs.appendFileSync(s.ledger, '{broken\n');
  assert.equal(countRuns(s.ledger, 'demo-skill'), 3);
  assert.equal(countRuns(path.join(s.home, 'nope.jsonl'), 'demo-skill'), 0);
});

test('broken input never throws and writes nothing', () => {
  const s = setup();
  for (const bad of ['', '{', '{}', '{"tool_input":{}}', 'null', '[]']) {
    assert.deepEqual(main('tool', bad, s.env, NOW), { line: null, output: null }, bad);
  }
  assert.equal(s.readLedger().length, 0);
});

test('unwritable data folder never throws', () => {
  const s = setup();
  const blocker = path.join(s.home, 'a-file');
  fs.writeFileSync(blocker, 'x');
  const env = { ...s.env, SKILL_COACH_DATA: blocker };
  assert.deepEqual(main('tool', s.event('event-pretooluse-skill.json'), env, NOW), { line: null, output: null });
});

test('two processes appending at once keep every line whole', async () => {
  const s = setup();
  const ev = s.event('event-pretooluse-skill.json');
  const code = `const {main}=require(${JSON.stringify(SCRIPT)});`
    + `for(let i=0;i<50;i++) main('tool', ${JSON.stringify(ev)}, ${JSON.stringify(s.env)}, new Date());`;
  const run = () => new Promise((resolve) => spawn(process.execPath, ['-e', code]).on('exit', resolve));
  await Promise.all([run(), run()]);
  const lines = fs.readFileSync(s.ledger, 'utf8').trim().split('\n');
  assert.equal(lines.length, 100);
  for (const l of lines) assert.equal(JSON.parse(l).skill, 'demo-skill');
});

test('CLI exits 0 on broken stdin and prints nothing', () => {
  const s = setup();
  const r = spawnSync(process.execPath, [SCRIPT, 'tool'], { input: '{', env: { ...process.env, ...s.env }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('CLI records a real event', () => {
  const s = setup();
  const r = spawnSync(process.execPath, [SCRIPT, 'tool'], { input: s.event('event-pretooluse-skill.json'), env: { ...process.env, ...s.env }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(s.readLedger()[0].skill, 'demo-skill');
});
