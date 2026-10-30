# Developing skill-coach

## Hard rule: nothing private in this repo

This repo is public. Nothing in it — code, tests, fixtures, docs, examples, file names
or commit messages — may come from a private workplace or a private life:

- no company, product, service, repo, host, environment or ticket names;
- no names or email addresses of people (the only identity is the no-reply author);
- no paths from a real machine (`/Users/<name>/…`);
- no examples taken from real work, even with the names changed. Invent them:
  `demo-skill`, `release-notes`, a tool called `fetch_records`.

Designs, plans and notes written while building the plugin stay outside the repo.

## How it is enforced

- `scripts/privacy-check.js` checks text against a private word list that lives outside
  the repo (`~/.config/skill-coach/private-words.txt`, or the path in
  `SKILL_COACH_PRIVATE_WORDS`), plus two generic checks: home folders and email addresses.
- The hooks in `.githooks/` run it on every commit (the staged changes and the message)
  and on every push (each pushed commit, then the whole tree). Turn them on once per
  clone: `git config core.hooksPath .githooks`.
- Never bypass a hook with `--no-verify`, and never weaken the check to get a commit
  through. A wrong match is fixed in the word list, outside the repo.

## Before every push: read the diff

A word list only knows the words in it. Before each push, read
`git log -p origin/main..HEAD` and check that every example, fixture and sentence is
invented and neutral — nothing that describes a real workplace's systems, data or tasks,
even with its names removed. Fix what you find, then push.

## Tests

`node --test tests/*.test.js` — CommonJS, `node:` built-ins only, no dependencies.
