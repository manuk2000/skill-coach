#!/usr/bin/env node
'use strict';

// Turns the last run of one skill in a Claude Code session transcript into a
// compact facts block for the judge. Read-only: prints JSON, writes nothing.

const fs = require('node:fs');
const path = require('node:path');

// Errors raised by Claude Code itself, not by the skill being scored.
const EXCLUDED = [/File has not been read yet/, /exceeds maximum allowed tokens/, /InputValidationError/,
  /not valid JSON/, /unexpected EOF while looking for matching/, /EISDIR|illegal operation on a directory/,
  /syntax error.*eval/, /hook error/];
const REJECTION = "The user doesn't want to proceed";
const SYSTEM_PREFIXES = ['<task-notification>', '<command-name>', '<local-command-stdout>', 'Caveat:'];
const CORRECTIONS = [
  /^(no|nope)\b(?!\s+(problem|worries|thanks|need)\b)/i,
  /^(don't|do not)\b(?!\s+worry\b)/i,
  /^stop\b/i,
  /\bi (meant|said|told you)\b/i,
  /\bthat's (wrong|not (right|it|what i))/i,
  /\buse\b[^.!?\n]{1,120}?\b(not|instead of|rather than)\b/i,
];
// skill-coach's own lines in an answer: the score footer, a setup report, the first-time question.
const COACH_LINE = /^\s*(?:[🟢🟡🔴]\s*(?:\d|n\/a)|⚠️|n\/a ·|skill-coach: |\*?Auto-improvement of logic is on for)/u;
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
const OVERSIZE = /exceeds maximum allowed tokens/;
const TOP_RESULTS = 3;

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return '';
      if (c.type === 'text') return c.text || '';
      if (c.type === 'tool_result') return textOf(c.content);
      return '';
    })
    .join('\n');
}

// Text bytes of a tool_result's content. Images and documents are not text and count 0.
function resultBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content);
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, c) => {
    if (typeof c === 'string') return sum + Buffer.byteLength(c);
    return c && c.type === 'text' && typeof c.text === 'string' ? sum + Buffer.byteLength(c.text) : sum;
  }, 0);
}

const toKb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

function resultKb(content) {
  return toKb(resultBytes(content));
}

function withoutCoachLines(text) {
  return text.split('\n').filter((l) => !COACH_LINE.test(l)).join('\n').trim();
}

function isLikelyCorrection(text) {
  const t = String(text).trim().replace(/[‘’]/g, "'");
  return CORRECTIONS.some((r) => r.test(t));
}

function toolResults(entry) {
  const c = entry.message && entry.message.content;
  return Array.isArray(c) ? c.filter((x) => x && x.type === 'tool_result') : [];
}

function genuineUserText(entry) {
  if (entry.type !== 'user' || toolResults(entry).length > 0) return null;
  const raw = textOf(entry.message && entry.message.content);
  const text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!text || SYSTEM_PREFIXES.some((p) => text.startsWith(p))) return null;
  return text;
}

function startsRun(entry, skill) {
  const c = entry.message && entry.message.content;
  if (entry.type === 'assistant' && Array.isArray(c)) {
    return c.some((x) => x && x.type === 'tool_use' && x.name === 'Skill' && x.input && x.input.skill === skill);
  }
  if (entry.type === 'user') {
    return textOf(c).includes(`<command-name>/${skill}</command-name>`);
  }
  return false;
}

function isCoachCall(entry) {
  const c = entry.message && entry.message.content;
  return entry.type === 'assistant' && Array.isArray(c) && c.some((x) => x && x.type === 'tool_use'
    && x.name === 'Skill' && x.input && typeof x.input.skill === 'string' && x.input.skill.startsWith('skill-coach:'));
}

function emptyTokens() {
  return { input: 0, cache_creation: 0, cache_read: 0, output: 0 };
}

// Claude Code writes one line per content block of a message, each repeating the message's
// usage, so a message counts once. A line without an id counts on its own.
function addUsage(tokens, seen, entry) {
  const message = entry.message || {};
  if (message.id) {
    if (seen.has(message.id)) return;
    seen.add(message.id);
  }
  const u = message.usage;
  if (!u || typeof u !== 'object') return;
  tokens.input += Number(u.input_tokens) || 0;
  tokens.cache_creation += Number(u.cache_creation_input_tokens) || 0;
  tokens.cache_read += Number(u.cache_read_input_tokens) || 0;
  tokens.output += Number(u.output_tokens) || 0;
}

// The text a typed command carries: its name and its arguments, without the tags.
function typedCommandText(raw) {
  const part = (tag) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(raw);
    return m ? m[1].trim() : '';
  };
  return [part('command-name'), part('command-args')].filter(Boolean).join(' ');
}

// What the user asked for before the run: the text of a typed command, or the last
// genuine user message before a Skill-tool start.
function startedBy(entries, start) {
  const first = entries[start];
  if (first.type === 'user') return clip(typedCommandText(textOf(first.message && first.message.content)), 500) || null;
  for (let i = start - 1; i >= 0; i--) {
    const text = genuineUserText(entries[i]);
    if (text !== null) return clip(text, 500);
  }
  return null;
}

function parseEntries(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !e.isMeta) entries.push(e);
    } catch {
      // A cut-off or malformed line, often the one still being written.
    }
  }
  return entries;
}

// Tokens and the largest tool result of a subagent's own transcript, or null when it has no lines.
function measureSubagent(lines) {
  const entries = parseEntries(lines);
  if (entries.length === 0) return null;
  const tokens = emptyTokens();
  const seen = new Set();
  const names = {};
  let largest = null;
  for (const e of entries) {
    const content = e.message && e.message.content;
    if (e.type === 'assistant') {
      addUsage(tokens, seen, e);
      if (Array.isArray(content)) content.forEach((x) => { if (x && x.type === 'tool_use') names[x.id] = x.name; });
    } else if (e.type === 'user') {
      for (const r of toolResults(e)) {
        const bytes = resultBytes(r.content);
        if (!largest || bytes > largest.bytes) largest = { tool: names[r.tool_use_id] || '', bytes };
      }
    }
  }
  return { tokens, largest_kb: largest ? toKb(largest.bytes) : 0, largest_tool: largest ? largest.tool : null };
}

// Fills a subagent entry from its result line. `launch` is the line's top-level toolUseResult.
function noteAgentResult(sub, result, launch) {
  const info = launch && typeof launch === 'object' ? launch : {};
  sub.async = info.isAsync === true || info.status === 'async_launched';
  // A background agent's result is only the launch notice; its report arrives later.
  sub.returned_kb = sub.async || result.is_error ? null : resultKb(result.content);
  if (typeof info.agentId === 'string' && info.agentId) sub.agent_id = info.agentId;
  if (typeof info.resolvedModel === 'string' && info.resolvedModel) sub.model_used = info.resolvedModel;
}

function emptyFacts(skill) {
  return {
    skill, found: false, start_time: null, end_time: null, tool_calls: 0, tool_errors: [],
    excluded_errors: 0, rejections: [], subagents: [], user_messages: [], final_answer: '',
    results: { count: 0, total_kb: 0, largest: [], oversize_errors: 0 },
    tokens: emptyTokens(), started_by: null,
  };
}

// options.readSubagent(agentId) returns a subagent transcript's lines, or null when it has none.
function readRun(lines, skill, options = {}) {
  const entries = parseEntries(lines);

  let start = -1;
  entries.forEach((e, i) => { if (startsRun(e, skill)) start = i; });
  const facts = emptyFacts(skill);
  if (start < 0) return facts;

  facts.found = true;
  facts.start_time = entries[start].timestamp || null;
  facts.started_by = startedBy(entries, start);
  const toolNames = {};
  const agentAt = {};
  const sizes = [];
  const seenMessages = new Set();
  // The call that starts the run only loads the skill; its result is not the skill's work.
  const startContent = entries[start].message && entries[start].message.content;
  const launcher = Array.isArray(startContent)
    ? startContent.find((x) => x && x.type === 'tool_use' && x.name === 'Skill' && x.input && x.input.skill === skill)
    : null;
  let sawAssistantText = false;
  // skill-coach's own end-of-run call closes the run; nothing after it is the skill's work.
  const marker = entries.findIndex((e, i) => i > start && isCoachCall(e));
  let end = marker >= 0 ? marker : entries.length - 1;
  let turnTexts = [];

  for (let i = start; i < entries.length; i++) {
    const e = entries[i];
    const content = e.message && e.message.content;
    if (marker >= 0 && i >= marker) {
      // Past the end-of-run call no tool work counts, but an answer printed after the
      // call is still the answer. The user's next message (a correction) ends the run.
      if (e.type === 'assistant' && Array.isArray(content)) {
        for (const item of content) {
          const text = item && item.type === 'text' && item.text ? withoutCoachLines(item.text) : '';
          if (text) turnTexts.push(text);
        }
        continue;
      }
      const text = genuineUserText(e);
      if (text === null) continue;
      facts.user_messages.push({ text: clip(text, 500), likely_correction: isLikelyCorrection(text) });
      end = i;
      break;
    }
    if (e.type === 'assistant') addUsage(facts.tokens, seenMessages, e);
    if (e.type === 'assistant' && Array.isArray(content)) {
      for (const item of content) {
        if (!item) continue;
        if (item.type === 'tool_use') {
          facts.tool_calls += 1;
          toolNames[item.id] = item.name;
          if (SUBAGENT_TOOLS.has(item.name)) {
            const input = item.input || {};
            agentAt[item.id] = facts.subagents.length;
            facts.subagents.push({
              type: input.subagent_type || 'general-purpose', description: input.description || '',
              model_requested: input.model || null, model_used: null, agent_id: null, async: null,
              tokens: null, largest_kb: null, largest_tool: null, returned_kb: null,
            });
          }
        } else if (item.type === 'text' && item.text) {
          sawAssistantText = true;
          turnTexts.push(item.text);
        }
      }
      continue;
    }
    if (e.type !== 'user') continue;

    const results = toolResults(e);
    if (results.length > 0) {
      for (const r of results) {
        const tool = toolNames[r.tool_use_id] || '';
        if (!launcher || r.tool_use_id !== launcher.id) sizes.push({ tool, bytes: resultBytes(r.content) });
        // With several results in one line it is unclear which one toolUseResult describes.
        if (agentAt[r.tool_use_id] !== undefined) noteAgentResult(facts.subagents[agentAt[r.tool_use_id]], r, results.length === 1 ? e.toolUseResult : null);
        if (!r.is_error) continue;
        const text = textOf(r.content);
        if (text.includes(REJECTION)) {
          const said = text.match(/the user said:\s*([\s\S]*)$/i);
          facts.rejections.push({ tool, text: clip(said ? said[1].trim() : '', 300) });
        } else if (EXCLUDED.some((p) => p.test(text))) {
          facts.excluded_errors += 1;
          if (OVERSIZE.test(text)) facts.results.oversize_errors += 1;
        } else {
          facts.tool_errors.push({ tool, text: clip(text, 300) });
        }
      }
      continue;
    }

    const text = genuineUserText(e);
    if (text === null) continue;
    facts.user_messages.push({ text: clip(text, 500), likely_correction: isLikelyCorrection(text) });
    if (marker < 0 && sawAssistantText) {
      // No end-of-run call recorded: the user's first reply after an answer ends the run.
      end = i;
      break;
    }
    turnTexts = [];
  }

  facts.results.count = sizes.length;
  facts.results.total_kb = toKb(sizes.reduce((sum, x) => sum + x.bytes, 0));
  facts.results.largest = [...sizes].sort((a, b) => b.bytes - a.bytes).slice(0, TOP_RESULTS)
    .map((x) => ({ tool: x.tool, kb: toKb(x.bytes) }));

  if (typeof options.readSubagent === 'function') {
    for (const sub of facts.subagents) {
      if (!sub.agent_id) continue;
      try {
        const subLines = options.readSubagent(sub.agent_id);
        if (subLines) Object.assign(sub, measureSubagent(subLines));
      } catch {
        // An unreadable subagent transcript leaves its numbers null.
      }
    }
  }

  // The answer is everything the assistant said in its final turn.
  const answer = turnTexts.join('\n\n');
  facts.final_answer = answer.length > 4000 ? answer.slice(-4000) : answer;
  facts.end_time = entries[end].timestamp || null;
  return facts;
}

// Reads a subagent's transcript, which Claude Code keeps beside the session transcript.
function subagentReader(transcriptPath) {
  const dir = path.join(String(transcriptPath).replace(/\.jsonl$/, ''), 'subagents');
  return (agentId) => {
    if (!/^[A-Za-z0-9_-]+$/.test(String(agentId))) return null;
    try {
      return fs.readFileSync(path.join(dir, `agent-${agentId}.jsonl`), 'utf8').split('\n');
    } catch {
      return null;
    }
  };
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const transcript = arg('--transcript');
  const skill = arg('--skill');
  if (!transcript || !skill) {
    process.stdout.write(JSON.stringify({ error: 'usage: read-run.js --transcript <path> --skill <name>' }) + '\n');
    return 1;
  }
  let raw;
  try {
    raw = fs.readFileSync(transcript, 'utf8');
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
    return 1;
  }
  process.stdout.write(JSON.stringify(readRun(raw.split('\n'), skill, { readSubagent: subagentReader(transcript) })) + '\n');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { readRun, isLikelyCorrection, resultKb, subagentReader };
