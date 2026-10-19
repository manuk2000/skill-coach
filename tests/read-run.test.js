const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readRun, isLikelyCorrection } = require('../scripts/read-run.js');

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
  for (const t of ['no, use X', "don't do that", 'stop', 'I meant the other one', 'I told you before', "that's wrong", 'use A not B']) {
    assert.equal(isLikelyCorrection(t), true, t);
  }
  for (const t of ['no problem', 'no worries', 'no thanks', "don't worry", 'looks good']) {
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
