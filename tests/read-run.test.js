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
