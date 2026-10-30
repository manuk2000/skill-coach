const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'privacy-check.js');
const WORDS = 'acme-corp\nre:\\bTICKET-\\d+\n# a comment\n\n';

// A throwaway git repo with its own private word list next to it (never inside it).
function repo(words = WORDS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-privacy-'));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  const list = `${dir}-words.txt`;
  if (words !== null) fs.writeFileSync(list, words);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (rel, text, message = 'change') => {
    write(rel, text);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const check = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir, encoding: 'utf8', input, env: { ...process.env, SKILL_COACH_PRIVATE_WORDS: list },
  });
  return { dir, git, write, commit, check };
}

test('a listed word in a staged line stops the commit', () => {
  const r = repo();
  r.write('a.md', 'line one\nhello acme-corp\n');
  r.git('add', 'a.md');
  const out = r.check(['--staged']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /a\.md:2: matches "acme-corp"/);
});

test('a regex line in the word list is matched', () => {
  const r = repo();
  r.write('b.md', 'see TICKET-1234 for details\n');
  r.git('add', 'b.md');
  const out = r.check(['--staged']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /b\.md:1: matches "re:/);
});

test('comments and blank lines in the word list are ignored', () => {
  const r = repo();
  r.write('c.md', 'this is a comment\n\n');
  r.git('add', 'c.md');
  assert.equal(r.check(['--staged']).status, 0);
});

test('a clean staged change passes', () => {
  const r = repo();
  r.write('d.md', 'release notes for demo-skill\n');
  r.git('add', 'd.md');
  const out = r.check(['--staged']);
  assert.equal(out.status, 0);
  assert.equal(out.stdout, '');
});

test('a private word in a staged file name stops the commit', () => {
  const r = repo();
  r.write('notes/acme-corp-plan.md', 'plain text\n');
  r.git('add', '-A');
  const out = r.check(['--staged']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /notes\/acme-corp-plan\.md: matches "acme-corp"/);
});

test('only added lines count: removing a private word is allowed', () => {
  const r = repo();
  r.commit('e.md', 'keep\nacme-corp\n');
  r.write('e.md', 'keep\n');
  r.git('add', 'e.md');
  assert.equal(r.check(['--staged']).status, 0);
});

test('a commit message with a listed word is refused; git comment lines are not read', () => {
  const r = repo();
  const msg = path.join(r.dir, '.git', 'MSG');
  fs.writeFileSync(msg, 'fix: tidy the acme-corp example\n');
  assert.equal(r.check(['--message', msg]).status, 1);
  fs.writeFileSync(msg, 'fix: tidy the example\n# acme-corp only in a git comment\n');
  assert.equal(r.check(['--message', msg]).status, 0);
});

test('a word added and removed again inside the pushed range is still found', () => {
  const r = repo();
  const base = r.commit('f.md', 'base\n');
  r.commit('f.md', 'base\nacme-corp\n');
  r.commit('f.md', 'base\n');
  const out = r.check(['--range', `${base}..HEAD`]);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /f\.md:2: matches "acme-corp"/);
});

test('a commit message inside the pushed range is checked too', () => {
  const r = repo();
  const base = r.commit('g.md', 'base\n');
  r.commit('g.md', 'base\nmore\n', 'feat: copy the acme-corp flow');
  const out = r.check(['--range', `${base}..HEAD`]);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /message: matches "acme-corp"/);
});

test('pre-push reads the pushed refs from stdin', () => {
  const r = repo();
  const base = r.commit('h.md', 'base\n');
  const head = r.commit('h.md', 'base\nTICKET-77\n');
  const zero = '0'.repeat(40);
  assert.equal(r.check(['--pre-push'], `refs/heads/main ${head} refs/heads/main ${base}\n`).status, 1);
  assert.equal(r.check(['--pre-push'], `refs/heads/main ${head} refs/heads/main ${zero}\n`).status, 1, 'a new branch is checked from its first commit');
  assert.equal(r.check(['--pre-push'], `(delete) ${zero} refs/heads/old ${base}\n`).status, 0, 'deleting a branch pushes nothing');
});

test('the whole tree is checked with --tree, binary files skipped', () => {
  const r = repo();
  r.commit('i.md', 'clean\n');
  fs.writeFileSync(path.join(r.dir, 'logo.bin'), Buffer.from([0, 1, 2, 0x61, 0x63, 0x6d, 0x65]));
  r.commit('docs/j.md', 'mentions acme-corp\n');
  const out = r.check(['--tree']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /docs\/j\.md:1: matches "acme-corp"/);
});

test('without a word list the generic checks still run and say so', () => {
  const r = repo(null);
  r.write('k.md', 'acme-corp is not known here\n');
  r.git('add', 'k.md');
  const out = r.check(['--staged']);
  assert.equal(out.status, 0);
  assert.match(out.stderr, /no private word list/);
});

test('a personal home folder and a real email address are caught', () => {
  const r = repo();
  // Built from pieces so this file itself never holds a home folder or an address.
  const home = ['', 'Users', 'jdoe', 'work'].join('/');
  const mail = ['jane', 'corp.io'].join('@');
  r.write('l.md', `cd ${home}\nwrite to ${mail}\n`);
  r.git('add', 'l.md');
  const out = r.check(['--staged']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /l\.md:1: matches "a personal home folder/);
  assert.match(out.stdout, /l\.md:2: matches "an email address/);
});

test('a no-reply address, an example address and a package version pass', () => {
  const r = repo();
  r.write('m.md', 'by 1+x@users.noreply.github.com and me@example.com, uses react@18.3.1 in /home/user\n');
  r.git('add', 'm.md');
  assert.equal(r.check(['--staged']).status, 0);
});

test('a placeholder home folder passes', () => {
  const r = repo();
  r.write('n.md', 'paths from a real machine (/Users/<name>/…) never belong here\n');
  r.git('add', 'n.md');
  assert.equal(r.check(['--staged']).status, 0);
});

test('an unknown mode is a usage error', () => {
  const r = repo();
  assert.equal(r.check(['--nope']).status, 2);
});
