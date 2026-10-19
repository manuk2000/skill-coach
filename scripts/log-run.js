#!/usr/bin/env node
'use strict';

// TEMPORARY PROBE (Task 2): saves the raw hook event so the real field names can be
// checked before the real recorder is written. Typed prompts are saved only when
// they start with "/". Always exits 0.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mode = process.argv[2] || 'unknown';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    if (mode === 'typed') {
      const prompt = (JSON.parse(input).prompt || '').trimStart();
      if (!prompt.startsWith('/')) return;
    }
    const dir = path.join(process.env.SKILL_COACH_DATA || path.join(os.homedir(), '.claude', 'self-improvement'), 'probe');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${mode}-${Date.now()}.json`), input);
  } catch {
    // A probe must never get in the way of a skill.
  }
});
