const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

test('plugin.json names skill-coach at 0.2.1', () => {
  const p = readJson('.claude-plugin/plugin.json');
  assert.equal(p.name, 'skill-coach');
  assert.match(p.version, /^0\.2\.1$/);
  assert.equal(p.license, 'MIT');
});

test('marketplace lists the plugin from its own root', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'skill-coach');
  assert.deepEqual(m.plugins.map((x) => [x.name, x.source]), [['skill-coach', './']]);
});

test('the marketplace describes the plugin as plugin.json does', () => {
  const p = readJson('.claude-plugin/plugin.json');
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.metadata.description, p.description);
  assert.deepEqual(m.plugins.map((x) => x.description), [p.description]);
});
