const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readRun, isLikelyCorrection, resultKb } = require('../scripts/read-run.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'transcript-basic.jsonl');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'read-run.js');
const LAST_START = '2026-10-16T10:00:00.000Z';
const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n');
const f = readRun(lines, 'demo-skill');

const userLine = (ts, content) => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content } });
const assistantText = (ts, text) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('picks the last run of the skill', () => assert.equal(f.start_time, LAST_START));

test('tool results are not user messages', () => assert.ok(f.user_messages.every((m) => !m.text.includes('tool output'))));

test('counts tool calls and errors', () => {
  assert.equal(f.tool_calls, 7);
  assert.equal(f.tool_errors.length, 1);
  assert.equal(f.tool_errors[0].tool, 'Read');
});

test('Claude Code guardrail errors are excluded', () => {
  assert.equal(f.excluded_errors, 2);
  assert.ok(f.tool_errors.every((e) => !/has not been read yet|hook error/.test(e.text)));
});

test('a rejected call is a rejection, with the user words', () => {
  assert.equal(f.rejections.length, 1);
  assert.equal(f.rejections[0].text, 'use the staging copy');
  assert.equal(f.rejections[0].tool, 'Bash');
  assert.ok(f.tool_errors.every((e) => !e.text.includes("doesn't want to proceed")));
});

test('a rejection without user words keeps empty text', () => {
  const r = readRun([
    JSON.stringify({ type: 'assistant', timestamp: 't1', message: { content: [{ type: 'tool_use', id: 'x1', name: 'Skill', input: { skill: 'demo-skill' } }] } }),
    JSON.stringify({ type: 'assistant', timestamp: 't2', message: { content: [{ type: 'tool_use', id: 'x2', name: 'Bash', input: {} }] } }),
    userLine('t3', [{ type: 'tool_result', tool_use_id: 'x2', is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected." }]),
  ], 'demo-skill');
  assert.equal(r.rejections.length, 1);
  assert.equal(r.rejections[0].text, '');
});

test('skips isMeta and system text', () => {
  assert.ok(f.user_messages.every((m) => !/system-reminder|task-notification|Base directory/.test(m.text)));
});

test('includes the next user message, flagged as a correction', () => {
  assert.equal(f.user_messages.at(-1).text, 'no, use the other folder');
  assert.equal(f.user_messages.at(-1).likely_correction, true);
  assert.equal(f.end_time, '2026-10-16T10:00:17.000Z');
});

test('keeps the final answer and the subagent call', () => {
  assert.equal(f.final_answer, 'Here is the final answer.');
  assert.deepEqual(f.subagents, [{ type: 'demo-agent', description: 'look around' }]);
});

test('tolerates a cut-off last line', () => assert.equal(f.found, true));

test('typed start is found from <command-name>', () => {
  const r = readRun([
    userLine('u1', 'unrelated earlier text'),
    userLine('u2', '<command-name>/demo-skill</command-name>\n<command-message>demo-skill</command-message>'),
    assistantText('a1', 'typed answer'),
    userLine('u3', 'looks good'),
  ], 'demo-skill');
  assert.equal(r.found, true);
  assert.equal(r.start_time, 'u2');
  assert.equal(r.final_answer, 'typed answer');
  assert.deepEqual(r.user_messages, [{ text: 'looks good', likely_correction: false }]);
});

test('unknown skill returns found false', () => assert.equal(readRun(lines, 'nope').found, false));

test('corrections vs false positives', () => {
  for (const t of ['no, use X', "don't do that", 'stop', 'I meant the other one', 'I told you before', "that's wrong", 'use A not B',
    'Use the Added heading for new features instead of New — follow the earlier releases, not this one.',
    'please use the short date format rather than the long one']) {
    assert.equal(isLikelyCorrection(t), true, t);
  }
  for (const t of ['no problem', 'no worries', 'no thanks', "don't worry", 'looks good', 'use the defaults', 'use it. Not now though']) {
    assert.equal(isLikelyCorrection(t), false, t);
  }
});

const assistantTool = (ts, id, name, input) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (ts, id, content, isError = false) => userLine(ts, [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }]);

test('stops at the run-end call and keeps the real answer', () => {
  const r = readRun([
    assistantTool('a0', 's1', 'Skill', { skill: 'demo-skill' }), toolResult('a1', 's1', 'loaded'),
    assistantTool('a2', 'b1', 'Bash', {}), toolResult('a3', 'b1', 'ok'),
    assistantText('a4', 'The real answer.'),
    assistantText('a5', 'Now running the end-of-run check.'),
    assistantTool('a6', 'r1', 'Skill', { skill: 'skill-coach:run-end' }), toolResult('a7', 'r1', 'loaded'),
    assistantTool('a8', 'j1', 'Agent', { subagent_type: 'skill-coach:judge', description: 'score' }), toolResult('a9', 'j1', '{}'),
  ], 'demo-skill');
  assert.equal(r.tool_calls, 2);
  assert.deepEqual(r.subagents, []);
  assert.ok(r.final_answer.includes('The real answer.'));
});

test('a correction after the footer is kept and the footer is not the answer', () => {
  const r = readRun([
    assistantTool('b0', 's1', 'Skill', { skill: 'demo-skill' }), toolResult('b1', 's1', 'loaded'),
    assistantText('b2', 'The real answer.'),
    assistantTool('b3', 'r1', 'Skill', { skill: 'skill-coach:run-end' }), toolResult('b4', 'r1', 'loaded'),
    assistantTool('b5', 'j1', 'Agent', { subagent_type: 'skill-coach:judge', description: 'score' }), toolResult('b6', 'j1', '{}'),
    assistantTool('b7', 'w1', 'Agent', { subagent_type: 'skill-coach:worker', description: 'apply' }), toolResult('b8', 'w1', 'footer'),
    assistantText('b9', '🟡 6/10 · Changed SKILL.md → «x» · Undo: /skill-coach:undo'),
    userLine('b10', 'no, use the other folder'),
    assistantTool('b11', 'r2', 'Skill', { skill: 'skill-coach:run-end' }),
  ], 'demo-skill');
  assert.ok(r.final_answer.includes('The real answer.'));
  assert.ok(!r.final_answer.includes('6/10'));
  assert.deepEqual(r.subagents, []);
  assert.equal(r.tool_calls, 1);
  assert.deepEqual(r.user_messages.at(-1), { text: 'no, use the other folder', likely_correction: true });
  assert.equal(r.end_time, 'b10');
});

test('a question mid-run does not end the run when run-end follows', () => {
  const r = readRun([
    assistantTool('c0', 's1', 'Skill', { skill: 'demo-skill' }), toolResult('c1', 's1', 'loaded'),
    assistantText('c2', 'Which folder?'),
    userLine('c3', 'the second one'),
    assistantTool('c4', 'b1', 'Bash', {}), toolResult('c5', 'b1', 'Error: boom', true),
    assistantText('c6', 'Done: here is the answer.'),
    assistantTool('c7', 'r1', 'Skill', { skill: 'skill-coach:run-end' }),
  ], 'demo-skill');
  assert.equal(r.tool_errors.length, 1);
  assert.equal(r.final_answer, 'Done: here is the answer.');
  assert.deepEqual(r.user_messages, [{ text: 'the second one', likely_correction: false }]);
  assert.equal(r.end_time, 'c7');
});

test('an answer printed after a clean run-end call is still the answer', () => {
  const r = readRun([
    assistantTool('d0', 's1', 'Skill', { skill: 'demo-skill' }), toolResult('d1', 's1', 'loaded'),
    assistantTool('d2', 'b1', 'Bash', {}), toolResult('d3', 'b1', 'ok'),
    assistantTool('d4', 'r1', 'Skill', { skill: 'skill-coach:run-end' }), toolResult('d5', 'r1', 'loaded'),
    assistantText('d6', 'The late answer.'),
    userLine('d7', 'no, use the other folder'),
    assistantTool('d8', 'r2', 'Skill', { skill: 'skill-coach:run-end' }),
  ], 'demo-skill');
  assert.equal(r.final_answer, 'The late answer.');
  assert.equal(r.tool_calls, 2);
  assert.deepEqual(r.user_messages.at(-1), { text: 'no, use the other folder', likely_correction: true });
  assert.equal(r.end_time, 'd7');
});

test("skill-coach's own lines after the call are not part of the answer", () => {
  const r = readRun([
    assistantTool('e0', 's1', 'Skill', { skill: 'demo-skill' }), toolResult('e1', 's1', 'loaded'),
    assistantTool('e2', 'r1', 'Skill', { skill: 'skill-coach:run-end' }), toolResult('e3', 'r1', 'loaded'),
    assistantTool('e4', 'j1', 'Agent', { subagent_type: 'skill-coach:judge', description: 'score' }), toolResult('e5', 'j1', '{}'),
    assistantText('e6', 'The late answer.\n\n🟡 6/10 · Changed SKILL.md → «x» · Undo: /skill-coach:undo\n*Auto-improvement of logic is on for `demo-skill`. Turn it off?*'),
  ], 'demo-skill');
  assert.equal(r.final_answer, 'The late answer.');
  assert.deepEqual(r.subagents, []);
});

test('text written before a tool call is in the answer; thinking is not', () => {
  // Claude Code stores each block of one response on its own line, so the text before a
  // tool call is a line of its own. Thinking blocks are never shown to the user.
  const thinking = JSON.stringify({ type: 'assistant', timestamp: 'e2', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'race: idea miss(0) → winner rg' }] } });
  const r = readRun([
    assistantTool('e0', 's1', 'Skill', { skill: 'demo-skill' }), toolResult('e1', 's1', 'loaded'),
    thinking,
    assistantText('e3', 'race: idea unavailable(0) · rg hit(3) → winner rg, verified yes'),
    assistantTool('e4', 'b1', 'Bash', { command: 'printf row >> log.md' }), toolResult('e5', 'b1', 'ok'),
    assistantText('e6', 'Logged.'),
  ], 'demo-skill');
  assert.equal(r.final_answer, 'race: idea unavailable(0) · rg hit(3) → winner rg, verified yes\n\nLogged.');
});

test('CLI prints facts for a readable transcript', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--transcript', FIXTURE, '--skill', 'demo-skill'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).tool_calls, 7);
});

test('CLI reports an unreadable transcript', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--transcript', '/nonexistent/x.jsonl', '--skill', 'demo-skill'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).error);
});

const SKILL_START = (ts) => assistantTool(ts, 's1', 'Skill', { skill: 'demo-skill' });
const USAGE = { input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 5 };
// Claude Code writes one line per content block of a message; each line repeats the message's id and usage.
const assistantMessage = (ts, id, content, usage = USAGE) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, role: 'assistant', content, usage } });

test('result sizes are measured and the largest named', () => {
  const r = readRun([
    SKILL_START('g0'), toolResult('g1', 's1', 'loaded'),
    assistantTool('g2', 'b1', 'Bash', {}), toolResult('g3', 'b1', 'x'.repeat(50 * 1024)),
    assistantTool('g4', 'b2', 'Bash', {}), toolResult('g5', 'b2', 'y'.repeat(2 * 1024)),
  ], 'demo-skill');
  assert.equal(r.results.count, 2);
  assert.deepEqual(r.results.largest[0], { tool: 'Bash', kb: 50 });
  assert.equal(r.results.total_kb, 52);
  assert.equal(r.results.oversize_errors, 0);
});

test('only the three largest results are listed, biggest first', () => {
  const sizes = [1, 9, 4, 7];
  const lines = [SKILL_START('k0')];
  sizes.forEach((kb, i) => lines.push(assistantTool(`k${i}a`, `b${i}`, 'Bash', {}), toolResult(`k${i}b`, `b${i}`, 'z'.repeat(kb * 1024))));
  const r = readRun(lines, 'demo-skill');
  assert.deepEqual(r.results.largest.map((x) => x.kb), [9, 7, 4]);
  assert.equal(r.results.count, 4);
});

test('images never count toward result size', () => {
  const r = readRun([
    SKILL_START('h0'), toolResult('h1', 's1', 'loaded'),
    assistantTool('h2', 'r1', 'Read', {}),
    toolResult('h3', 'r1', [{ type: 'image', source: { data: 'A'.repeat(300000) } }]),
  ], 'demo-skill');
  assert.equal(r.results.largest[0].kb, 0);
  assert.equal(r.results.total_kb, 0);
});

test('an over-limit result is counted, not blamed', () => {
  const r = readRun([
    SKILL_START('i0'), toolResult('i1', 's1', 'loaded'),
    assistantTool('i2', 'r1', 'Read', {}),
    toolResult('i3', 'r1', 'File content (31000 tokens) exceeds maximum allowed tokens (25000). Use offset and limit.', true),
  ], 'demo-skill');
  assert.equal(r.results.oversize_errors, 1);
  assert.equal(r.tool_errors.length, 0);
  assert.equal(r.excluded_errors, 1);
});

test('results and tokens stop at the run-end call', () => {
  const r = readRun([
    SKILL_START('l0'), toolResult('l1', 's1', 'loaded'),
    assistantMessage('l2', 'm1', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }]), toolResult('l3', 'b1', 'x'.repeat(3 * 1024)),
    assistantMessage('l4', 'm2', [{ type: 'tool_use', id: 'r1', name: 'Skill', input: { skill: 'skill-coach:run-end' } }]),
    toolResult('l5', 'r1', 'q'.repeat(60 * 1024)),
    assistantMessage('l6', 'm3', [{ type: 'text', text: 'late' }]),
  ], 'demo-skill');
  assert.equal(r.results.count, 1);
  assert.equal(r.results.total_kb, 3);
  assert.equal(r.tokens.input, 100);
});

test('tokens are counted once per message', () => {
  const r = readRun([
    SKILL_START('j0'), toolResult('j1', 's1', 'loaded'),
    assistantMessage('j2', 'msg_1', [{ type: 'text', text: 'one' }]),
    assistantMessage('j3', 'msg_1', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }]),
    toolResult('j4', 'b1', 'ok'),
    assistantMessage('j5', 'msg_2', [{ type: 'text', text: 'two' }]),
  ], 'demo-skill');
  assert.deepEqual(r.tokens, { input: 200, cache_creation: 20, cache_read: 2000, output: 10 });
});

test('assistant lines without an id each count', () => {
  const r = readRun([
    SKILL_START('m0'),
    assistantMessage('m1', undefined, [{ type: 'text', text: 'one' }]),
    assistantMessage('m2', undefined, [{ type: 'text', text: 'two' }]),
  ], 'demo-skill');
  assert.equal(r.tokens.input, 200);
  assert.equal(r.tokens.output, 10);
});

test('the prompt that started the run is kept', () => {
  const r = readRun([
    userLine('n0', 'an older question'),
    assistantText('n1', 'an older answer'),
    userLine('n2', 'check the export and also list the failures'),
    SKILL_START('n3'),
  ], 'demo-skill');
  assert.equal(r.started_by, 'check the export and also list the failures');
});

test('started_by is clipped, and null when nothing came before', () => {
  const clipped = readRun([userLine('o0', 'w'.repeat(900)), SKILL_START('o1')], 'demo-skill');
  assert.equal(clipped.started_by.length, 500);
  assert.equal(readRun([SKILL_START('o2')], 'demo-skill').started_by, null);
});

test('a typed command starts the run with its own text', () => {
  const r = readRun([
    userLine('p0', 'an unrelated earlier message'),
    userLine('p1', '<command-name>/demo-skill</command-name><command-args>last week</command-args>'),
    assistantText('p2', 'typed answer'),
  ], 'demo-skill');
  assert.ok(r.started_by.includes('last week'));
  assert.ok(!r.started_by.includes('<command'));
  assert.ok(!r.started_by.includes('earlier'));
});

test('a run that is not found has empty result and token facts', () => {
  const r = readRun([userLine('q0', 'hello')], 'demo-skill');
  assert.deepEqual(r.results, { count: 0, total_kb: 0, largest: [], oversize_errors: 0 });
  assert.deepEqual(r.tokens, { input: 0, cache_creation: 0, cache_read: 0, output: 0 });
  assert.equal(r.started_by, null);
});

test('resultKb counts text bytes only, to one decimal', () => {
  assert.equal(resultKb('x'.repeat(1536)), 1.5);
  assert.equal(resultKb([{ type: 'text', text: 'a' }, { type: 'text', text: 'é' }]), 0);
  assert.equal(resultKb([{ type: 'text', text: 'x'.repeat(2048) }, { type: 'image', source: { data: 'A'.repeat(9999) } }, { type: 'document', source: { data: 'B'.repeat(9999) } }]), 2);
  assert.equal(resultKb(undefined), 0);
});
