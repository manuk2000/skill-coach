#!/usr/bin/env node
'use strict';

// Turns the last run of one skill in a Claude Code session transcript into a
// compact facts block for the judge. Read-only: prints JSON, writes nothing.

const fs = require('node:fs');

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
  /\buse \S+ (not|instead of) \S+/i,
];
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

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

function emptyFacts(skill) {
  return {
    skill, found: false, start_time: null, end_time: null, tool_calls: 0, tool_errors: [],
    excluded_errors: 0, rejections: [], subagents: [], user_messages: [], final_answer: '',
  };
}

function readRun(lines, skill) {
  const entries = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !e.isMeta) entries.push(e);
    } catch {
      // A cut-off or malformed line, often the one still being written.
    }
  }

  let start = -1;
  entries.forEach((e, i) => { if (startsRun(e, skill)) start = i; });
  const facts = emptyFacts(skill);
  if (start < 0) return facts;

  facts.found = true;
  facts.start_time = entries[start].timestamp || null;
  const toolNames = {};
  let sawAssistantText = false;
  let end = entries.length - 1;

  for (let i = start; i < entries.length; i++) {
    const e = entries[i];
    const content = e.message && e.message.content;
    if (e.type === 'assistant' && Array.isArray(content)) {
      for (const item of content) {
        if (!item) continue;
        if (item.type === 'tool_use') {
          facts.tool_calls += 1;
          toolNames[item.id] = item.name;
          if (SUBAGENT_TOOLS.has(item.name)) {
            const input = item.input || {};
            facts.subagents.push({ type: input.subagent_type || 'general-purpose', description: input.description || '' });
          }
        } else if (item.type === 'text' && item.text) {
          sawAssistantText = true;
          facts.final_answer = clip(item.text, 4000);
        }
      }
      continue;
    }
    if (e.type !== 'user') continue;

    const results = toolResults(e);
    if (results.length > 0) {
      for (const r of results) {
        if (!r.is_error) continue;
        const text = textOf(r.content);
        const tool = toolNames[r.tool_use_id] || '';
        if (text.includes(REJECTION)) {
          const said = text.match(/the user said:\s*([\s\S]*)$/i);
          facts.rejections.push({ tool, text: clip(said ? said[1].trim() : '', 300) });
        } else if (EXCLUDED.some((p) => p.test(text))) {
          facts.excluded_errors += 1;
        } else {
          facts.tool_errors.push({ tool, text: clip(text, 300) });
        }
      }
      continue;
    }

    const text = genuineUserText(e);
    if (text === null) continue;
    facts.user_messages.push({ text: clip(text, 500), likely_correction: isLikelyCorrection(text) });
    if (sawAssistantText) {
      end = i;
      break;
    }
  }

  facts.end_time = entries[end].timestamp || null;
  return facts;
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
  process.stdout.write(JSON.stringify(readRun(raw.split('\n'), skill)) + '\n');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { readRun, isLikelyCorrection };
