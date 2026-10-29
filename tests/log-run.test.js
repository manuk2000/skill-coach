const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { main, isConnected, countRuns, dataDir, largeResultKb, largeResultIgnore, endedRun, costNote } = require('../scripts/log-run.js');

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

test('every run of a connected skill is announced with its session', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', CONNECTED);
  const r = main('tool', s.event('event-pretooluse-skill.json'), s.env, NOW);
  assert.equal(r.line.n, 1);
  const text = JSON.parse(r.output).hookSpecificOutput.additionalContext;
  assert.match(text, /run 1 of demo-skill recorded \(session 00000000-0000-0000-0000-000000000000\)/);
  assert.match(text, /skill-coach:run-end/);
  assert.doesNotMatch(text, /spot check/);
});

test('a connected run inside a subagent names the agent', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', CONNECTED);
  const r = main('tool', s.event('event-pretooluse-skill-subagent.json'), s.env, NOW);
  assert.match(JSON.parse(r.output).hookSpecificOutput.additionalContext, /agent a0000000000000001/);
});

test('10th run of an unconnected skill prints nothing', () => {
  const s = setup();
  s.writeSkill(s.home, 'demo-skill', '---\nname: demo-skill\n---\n# Demo\n');
  s.seed('demo-skill', 9);
  const r = main('tool', s.event('event-pretooluse-skill.json'), s.env, NOW);
  assert.equal(r.line.n, 10);
  assert.equal(r.output, null);
});

test('isConnected accepts a byte-order mark and a padded closing line', () => {
  const s = setup();
  s.writeSkill(s.home, 'bom-skill', `﻿${CONNECTED}`);
  s.writeSkill(s.home, 'pad-skill', '---\nname: pad-skill\nskill-coach:\n  rubric: r.md\n--- \n# Pad\n');
  assert.equal(isConnected('bom-skill', s.project, s.home), true);
  assert.equal(isConnected('pad-skill', s.project, s.home), true);
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

// ---- cost note when run-end starts ----

const SESSION = '00000000-0000-0000-0000-000000000000';
const AGENT = 'a0000000000000001';
const NOT_CONNECTED = '---\nname: demo-skill\n---\n# Demo\n';

const entry = (type, content, extra = {}) => ({ type, timestamp: 't', message: { role: type, content }, ...extra });
const skillStart = () => entry('assistant', [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'demo-skill' } }]);
const toolUse = (id, name, input = {}) => entry('assistant', [{ type: 'tool_use', id, name, input }]);
const toolResultOf = (id, content, isError = false) => entry('user', [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }]);
// A run whose one tool returns `content`.
const runWith = (tool, content, isError = false) => [skillStart(), toolResultOf('s1', 'loaded'), toolUse('b1', tool), toolResultOf('b1', content, isError)];
const kb = (n) => 'x'.repeat(n * 1024);
const SMALL = runWith('fetch_records', kb(2));
const note = (text) => `skill-coach: cost check due for demo-skill — ${text}; score this run.`;

// Writes the transcript(s) and ledger row for one ended run, and returns the run-end event.
function endScenario(s, { main = SMALL, sub = null, skillText = CONNECTED, agent = null, row = {}, eventExtra = {} }) {
  const transcript = path.join(s.home, `${SESSION}.jsonl`);
  const subPath = path.join(s.home, SESSION, 'subagents', `agent-${AGENT}.jsonl`);
  const write = (file, entries) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  };
  write(transcript, main);
  if (sub) write(subPath, sub);
  s.writeSkill(s.home, 'demo-skill', skillText);
  fs.mkdirSync(s.env.SKILL_COACH_DATA, { recursive: true });
  const base = { type: 'run', time: NOW.toISOString(), session: SESSION, cwd: s.project, skill: 'demo-skill', via: 'tool', n: 1 };
  fs.appendFileSync(s.ledger, JSON.stringify({ ...base, transcript: agent ? subPath : transcript, ...(agent ? { agent } : {}), ...row }) + '\n');
  return s.event('event-pretooluse-run-end.json', { transcript_path: transcript, ...(agent ? { agent_id: agent } : {}), ...eventExtra });
}
const noteOf = (r) => (r.output ? JSON.parse(r.output).hookSpecificOutput : null);

test('largeResultKb reads the skill, then defaults, then 40', () => {
  const s = setup();
  const dir = s.env.SKILL_COACH_DATA;
  assert.equal(largeResultKb(dir, 'demo-skill'), 40);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ defaults: { text_auto: 'on' }, skills: { 'demo-skill': {} } }));
  assert.equal(largeResultKb(dir, 'demo-skill'), 40);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ defaults: { large_result_kb: 60 }, skills: { 'demo-skill': { large_result_kb: 20 } } }));
  assert.equal(largeResultKb(dir, 'demo-skill'), 20);
  assert.equal(largeResultKb(dir, 'other-skill'), 60);
  fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
  assert.equal(largeResultKb(dir, 'demo-skill'), 40);
});

test('costNote gives one of three sentences, main before subagent', () => {
  const facts = (largest, oversize = 0, subs = []) => ({ results: { largest, oversize_errors: oversize }, subagents: subs });
  const sub = (kbValue, tool) => ({ largest_kb: kbValue, largest_tool: tool });
  assert.equal(costNote('demo-skill', facts([{ tool: 'Bash', kb: 49.6 }]), 40), note('largest result 50 KB from Bash (main)'));
  assert.equal(costNote('demo-skill', facts([{ tool: 'Bash', kb: 2 }], 0, [sub(45, 'fetch_records')]), 40), note('largest result 45 KB from fetch_records (subagent)'));
  assert.equal(costNote('demo-skill', facts([], 1), 40), note("a result was over the tool's size limit (main)"));
  assert.equal(costNote('demo-skill', facts([{ tool: 'Bash', kb: 50 }], 1, [sub(90, 'fetch_records')]), 40), note('largest result 50 KB from Bash (main)'));
  assert.equal(costNote('demo-skill', facts([], 1, [sub(90, 'fetch_records')]), 40), note("a result was over the tool's size limit (main)"));
  assert.equal(costNote('demo-skill', facts([{ tool: 'Bash', kb: 39.9 }], 0, [sub(12, 'x'), sub(null, null)]), 40), null);
  assert.equal(costNote('demo-skill', facts([{ tool: 'Bash', kb: 40 }]), 40), note('largest result 40 KB from Bash (main)'));
});

test('endedRun picks the newest run of the session and the same agent', () => {
  const s = setup();
  fs.mkdirSync(s.env.SKILL_COACH_DATA, { recursive: true });
  const rows = [
    { type: 'run', session: SESSION, skill: 'demo-a', n: 1 },
    { type: 'run', session: SESSION, skill: 'demo-b', n: 1, agent: AGENT },
    { type: 'run', session: 'other-session', skill: 'demo-c', n: 1 },
    { type: 'run', session: SESSION, skill: 'skill-coach:run-end', n: 1 },
    { type: 'note', session: SESSION, skill: 'demo-d' },
  ];
  fs.writeFileSync(s.ledger, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{broken\n');
  assert.equal(endedRun(s.ledger, SESSION, undefined).skill, 'demo-a');
  assert.equal(endedRun(s.ledger, SESSION, AGENT).skill, 'demo-b');
  assert.equal(endedRun(s.ledger, SESSION, 'a-different-agent'), null);
  assert.equal(endedRun(s.ledger, 'no-such-session'), null);
  assert.equal(endedRun(path.join(s.home, 'nope.jsonl'), SESSION), null);
});

test('run-end after a 50 KB result prints the cost note', () => {
  const s = setup();
  const r = main('tool', endScenario(s, { main: runWith('fetch_records', kb(50)) }), s.env, NOW);
  assert.deepEqual(noteOf(r), {
    hookEventName: 'PreToolUse',
    additionalContext: 'skill-coach: cost check due for demo-skill — largest result 50 KB from fetch_records (main); score this run.',
  });
  assert.equal(r.line.skill, 'skill-coach:run-end');
  assert.equal(s.readLedger().length, 2);
});

test('a higher limit in config.json silences the note', () => {
  const s = setup();
  const event = endScenario(s, { main: runWith('fetch_records', kb(50)) });
  fs.writeFileSync(path.join(s.env.SKILL_COACH_DATA, 'config.json'), JSON.stringify({ skills: { 'demo-skill': { large_result_kb: 100 } } }));
  assert.equal(main('tool', event, s.env, NOW).output, null);
});

test('a 45 KB result inside a subagent prints the subagent note', () => {
  const s = setup();
  const main1 = [skillStart(), toolResultOf('s1', 'loaded'), toolUse('ag1', 'Agent', { description: 'fetch' }),
    { ...toolResultOf('ag1', 'report'), toolUseResult: { agentId: AGENT, resolvedModel: 'm' } }];
  const sub = [toolUse('f1', 'fetch_records'), toolResultOf('f1', kb(45))];
  const r = main('tool', endScenario(s, { main: main1, sub }), s.env, NOW);
  assert.equal(noteOf(r).additionalContext, note('largest result 45 KB from fetch_records (subagent)'));
});

// The shape Claude Code writes for an over-limit result: no is_error, saved to a file, about 1 KB.
const SAVED = 'Error: result (94,299 characters across 1,017 lines) exceeds maximum allowed tokens. Output has been saved to /tmp/x.txt';
const savedRun = (tool) => [skillStart(), toolResultOf('s1', 'loaded'), toolUse('b1', tool),
  entry('user', [{ type: 'tool_result', tool_use_id: 'b1', content: [{ type: 'text', text: SAVED }] }])];

test('an over-limit result saved to a file prints its real size', () => {
  const s = setup();
  const r = main('tool', endScenario(s, { main: savedRun('fetch_records') }), s.env, NOW);
  assert.equal(noteOf(r).additionalContext, note('largest result 92 KB from fetch_records (main)'));
});

test('an over-limit error without a size prints the size-limit note', () => {
  const s = setup();
  const error = 'File content (31000 tokens) exceeds maximum allowed tokens (25000). Use offset and limit.';
  const r = main('tool', endScenario(s, { main: runWith('Read', error, true) }), s.env, NOW);
  assert.equal(noteOf(r).additionalContext, note("a result was over the tool's size limit (main)"));
});

test('an over-limit result inside a subagent prints the subagent note', () => {
  const s = setup();
  const main1 = [skillStart(), toolResultOf('s1', 'loaded'), toolUse('ag1', 'Agent', { description: 'fetch' }),
    { ...toolResultOf('ag1', 'report'), toolUseResult: { agentId: AGENT, resolvedModel: 'm' } }];
  const r = main('tool', endScenario(s, { main: main1, sub: savedRun('fetch_records').slice(2) }), s.env, NOW);
  assert.equal(noteOf(r).additionalContext, note('largest result 92 KB from fetch_records (subagent)'));
});

test('largeResultIgnore reads the skill, then defaults, then none', () => {
  const s = setup();
  const dir = s.env.SKILL_COACH_DATA;
  assert.deepEqual(largeResultIgnore(dir, 'demo-skill'), []);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ defaults: { large_result_ignore: ['read_docs'] }, skills: { 'demo-skill': { large_result_ignore: ['fetch_records', 7] } } }));
  assert.deepEqual(largeResultIgnore(dir, 'demo-skill'), ['fetch_records']);
  assert.deepEqual(largeResultIgnore(dir, 'other-skill'), ['read_docs']);
  fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
  assert.deepEqual(largeResultIgnore(dir, 'demo-skill'), []);
});

test('a tool on the ignore list never starts a cost check', () => {
  const s = setup();
  const sub = [toolUse('f1', 'fetch_records'), toolResultOf('f1', kb(60))];
  const main1 = [...runWith('fetch_records', kb(50)), toolUse('ag1', 'Agent', { description: 'fetch' }),
    { ...toolResultOf('ag1', 'report'), toolUseResult: { agentId: AGENT, resolvedModel: 'm' } },
    toolUse('b2', 'fetch_records'), entry('user', [{ type: 'tool_result', tool_use_id: 'b2', content: SAVED }])];
  const event = endScenario(s, { main: main1, sub });
  assert.match(noteOf(main('tool', event, s.env, NOW)).additionalContext, /fetch_records \(main\)/);
  fs.writeFileSync(path.join(s.env.SKILL_COACH_DATA, 'config.json'), JSON.stringify({ skills: { 'demo-skill': { large_result_ignore: ['fetch_records'] } } }));
  assert.equal(main('tool', event, s.env, NOW).output, null);
});

test('small results print no cost note', () => {
  const s = setup();
  const r = main('tool', endScenario(s, {}), s.env, NOW);
  assert.equal(r.output, null);
  assert.equal(r.line.skill, 'skill-coach:run-end');
});

test('screenshots never start a cost check', () => {
  const s = setup();
  const image = [{ type: 'image', source: { type: 'base64', data: 'A'.repeat(300000) } }];
  const main1 = [skillStart(), toolResultOf('s1', 'loaded'), toolUse('ag1', 'Agent', {}),
    { ...toolResultOf('ag1', 'report'), toolUseResult: { agentId: AGENT } }, ...runWith('Read', image).slice(2)];
  const sub = [toolUse('f1', 'screenshot'), toolResultOf('f1', image)];
  assert.equal(main('tool', endScenario(s, { main: main1, sub }), s.env, NOW).output, null);
});

test('an unconnected skill gets no cost note', () => {
  const s = setup();
  const r = main('tool', endScenario(s, { main: runWith('fetch_records', kb(50)), skillText: NOT_CONNECTED }), s.env, NOW);
  assert.equal(r.output, null);
  assert.equal(r.line.skill, 'skill-coach:run-end');
});

test('a run inside a subagent is read from its own transcript', () => {
  const big = runWith('fetch_records', kb(50));
  // The big result is only in the subagent's transcript: the note names it.
  let s = setup();
  let event = endScenario(s, { main: SMALL, sub: big, agent: AGENT });
  assert.equal(noteOf(main('tool', event, s.env, NOW)).additionalContext, note('largest result 50 KB from fetch_records (main)'));
  // The big result is only in the main transcript: the subagent's run was small.
  s = setup();
  event = endScenario(s, { main: big, sub: SMALL, agent: AGENT });
  assert.equal(main('tool', event, s.env, NOW).output, null);
});

test('run-end skips a newer unconnected run and notes the connected one', () => {
  const s = setup();
  const event = endScenario(s, { main: runWith('fetch_records', kb(50)) });
  // A helper skill the connected run called afterwards: a newer row of the same session, not connected.
  fs.appendFileSync(s.ledger, JSON.stringify({ type: 'run', session: SESSION, transcript: path.join(s.home, `${SESSION}.jsonl`), cwd: s.project, skill: 'helper-skill', n: 1 }) + '\n');
  const r = main('tool', event, s.env, NOW);
  assert.equal(noteOf(r).additionalContext, note('largest result 50 KB from fetch_records (main)'));
  assert.equal(endedRun(s.ledger, SESSION, undefined, (row) => row.skill === 'helper-skill').skill, 'helper-skill');
  assert.equal(endedRun(s.ledger, SESSION, undefined, () => false), null);
});

// A second connected skill that ran after demo-skill in the same session, with a small result.
function addLaterRun(s, skill) {
  const transcript = path.join(s.home, `${skill}.jsonl`);
  const start = entry('assistant', [{ type: 'tool_use', id: 's9', name: 'Skill', input: { skill } }]);
  fs.writeFileSync(transcript, [start, toolResultOf('s9', 'loaded'), toolUse('b9', 'Bash'), toolResultOf('b9', kb(2))].map((e) => JSON.stringify(e)).join('\n') + '\n');
  s.writeSkill(s.home, skill, CONNECTED.replace('demo-skill', skill));
  fs.appendFileSync(s.ledger, JSON.stringify({ type: 'run', session: SESSION, transcript, cwd: s.project, skill, via: 'tool', n: 1 }) + '\n');
}
const runEndWith = (event, args) => JSON.stringify({ ...JSON.parse(event), tool_input: { skill: 'skill-coach:run-end', args } });

test('run-end names the ended skill in its args, and the hook reads that run', () => {
  const s = setup();
  const event = endScenario(s, { main: runWith('fetch_records', kb(50)) });
  addLaterRun(s, 'demo-b');
  assert.equal(main('tool', event, s.env, NOW).output, null, 'without args the newest connected run (demo-b) is read');
  const named = main('tool', runEndWith(event, 'demo-skill'), s.env, NOW);
  assert.equal(noteOf(named).additionalContext, note('largest result 50 KB from fetch_records (main)'));
  assert.equal(noteOf(main('tool', runEndWith(event, ' /demo-skill  more words'), s.env, NOW)).additionalContext,
    note('largest result 50 KB from fetch_records (main)'), 'the first word counts, a leading slash is dropped');
  assert.equal(main('tool', runEndWith(event, 'unknown-skill'), s.env, NOW).output, null, 'a name with no run falls back to the newest connected run');
});

test('a run-end outside a subagent ignores the subagent rows', () => {
  const s = setup();
  const event = endScenario(s, { main: SMALL });
  // A newer row of the same session that belongs to a subagent, with a big result.
  const subPath = path.join(s.home, SESSION, 'subagents', `agent-${AGENT}.jsonl`);
  fs.mkdirSync(path.dirname(subPath), { recursive: true });
  fs.writeFileSync(subPath, runWith('fetch_records', kb(50)).map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.appendFileSync(s.ledger, JSON.stringify({ type: 'run', session: SESSION, transcript: subPath, cwd: s.project, skill: 'demo-skill', agent: AGENT, n: 2 }) + '\n');
  assert.equal(main('tool', event, s.env, NOW).output, null);
});

test('a long transcript is read in under 2 seconds', () => {
  const s = setup();
  const lines = [skillStart(), toolResultOf('s1', 'loaded')];
  for (let i = 0; i < 9998; i++) lines.push(toolUse(`b${i}`, 'Bash', { command: 'ls' }), toolResultOf(`b${i}`, 'some output '.repeat(40)));
  lines.push(toolUse('big', 'fetch_records'), toolResultOf('big', kb(50)));
  assert.ok(lines.length >= 20000);
  const event = endScenario(s, { main: lines });
  const started = Date.now();
  const r = main('tool', event, s.env, NOW);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(noteOf(r).additionalContext, note('largest result 50 KB from fetch_records (main)'));
});

test('a missing transcript prints nothing and exits 0', () => {
  const s = setup();
  const event = endScenario(s, { row: { transcript: path.join(s.home, 'gone.jsonl') } });
  const r = main('tool', event, s.env, NOW);
  assert.equal(r.output, null);
  assert.equal(r.line.skill, 'skill-coach:run-end');
  const cli = spawnSync(process.execPath, [SCRIPT, 'tool'], { input: event, env: { ...process.env, ...s.env }, encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.equal(cli.stdout, '');
});

test('run-end with no earlier run still logs its own line and prints nothing', () => {
  const s = setup();
  const r = main('tool', s.event('event-pretooluse-run-end.json'), s.env, NOW);
  assert.equal(r.output, null);
  assert.equal(r.line.skill, 'skill-coach:run-end');
  assert.equal(s.readLedger().length, 1);
});

test('CLI prints the cost note as hook output', () => {
  const s = setup();
  const event = endScenario(s, { main: runWith('fetch_records', kb(50)) });
  const r = spawnSync(process.execPath, [SCRIPT, 'tool'], { input: event, env: { ...process.env, ...s.env }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^skill-coach: cost check due for demo-skill — largest result 50 KB/);
});
