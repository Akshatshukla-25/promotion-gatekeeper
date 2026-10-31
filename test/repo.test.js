import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';
import { cherry, mergeTree } from '../src/git.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { seed, lookupFrom, g } from './helpers.js';

let s;
before(() => { s = seed(); });

test('included vs equivalent counts on seeded repo (dev -> uat)', () => {
  const items = cherry(s.dir, 'origin/uat', s.shas.featConflict);
  assert.equal(items.filter((i) => i.mark === '+').length, 4);
  const equivalent = items.filter((i) => i.mark === '-');
  assert.equal(equivalent.length, 1);
  assert.equal(equivalent[0].sha, s.shas.fix);
});

test('conflict detection names app.txt', () => {
  const r = mergeTree(s.dir, 'origin/uat', s.shas.featConflict);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.files, ['app.txt']);
});

test('merge-tree reports clean when there is no conflict', () => {
  const r = mergeTree(s.dir, 'origin/uat', s.shas.featTested);
  assert.equal(r.conflict, false);
});

test('merge-tree error (bad ref) throws', () => {
  assert.throws(() => mergeTree(s.dir, 'origin/uat', 'does-not-exist'));
});

test('missing backports are checked for every environment pair (prod hotfix and uat-only change)', async () => {
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  const by = Object.fromEntries(res.missingBackports.map((c) => [c.sha, c]));
  assert.deepEqual(Object.keys(by).sort(), [s.shas.hotfix, s.shas.uatEdit].sort());
  assert.deepEqual(by[s.shas.hotfix].missingFrom, ['dev', 'uat']);
  assert.deepEqual(by[s.shas.hotfix].presentIn, ['prod']);
  assert.deepEqual(by[s.shas.uatEdit].missingFrom, ['dev']);
});

test('full analysis of the seeded repo', async () => {
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  assert.equal(res.verdict, 'Blocked');
  assert.equal(res.equivalentCount, 1);
  assert.deepEqual(res.counts, { included: 4, tested: 2, inferred: 0, untested: 1, pending: 0, failed: 1, unchecked: 0 });
});

test('analysis never touches the working tree', async () => {
  const { gitOk } = await import('../src/git.js');
  await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  assert.equal(gitOk(['status', '--porcelain'], { cwd: s.dir }).trim(), '');
  assert.equal(gitOk(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: s.dir }).trim(), 'prod');
});

test('CI lookup runs in batches of 10 and caps at 100 commits', async () => {
  let inFlight = 0; let maxInFlight = 0; let calls = 0;
  const lookup = async () => {
    calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return { checkRuns: [{ name: 'b', status: 'completed', conclusion: 'success' }], statuses: [] };
  };
  // dev vs prod: dev has 5 commits not in prod; use maxCommits=3, batchSize=2 to exercise the limits
  const res = await analyze({ cwd: s.dir, base: 'prod', head: s.shas.featConflict, ciLookup: lookup, maxCommits: 3, batchSize: 2 });
  assert.equal(calls, 3);
  assert.ok(maxInFlight <= 2);
  assert.equal(res.counts.unchecked, res.counts.included - 3);
});

test('ledger: presence per environment, patch-id twins merged, cherry-pick conflict status', async () => {
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  assert.equal(res.ledger.length, 7);
  const row = (sha) => res.ledger.find((r) => r.shas.includes(sha));
  assert.deepEqual(row(s.shas.fix).presence, { dev: 'yes', uat: 'yes', prod: 'no' });
  assert.ok(row(s.shas.fix).shas.includes(s.shas.fixOnUat), 'cherry-picked twin merged into one row');
  assert.deepEqual(row(s.shas.hotfix).presence, { dev: 'no', uat: 'no', prod: 'yes' });
  assert.deepEqual(row(s.shas.uatEdit).presence, { dev: 'no', uat: 'yes', prod: 'no' });
  assert.equal(row(s.shas.featConflict).included, true);
  assert.equal(row(s.shas.hotfix).included, false);
  const c = row(s.shas.featConflict).conflict;
  assert.deepEqual([c.env, c.conflict, c.files], ['uat', true, ['app.txt']]);
  assert.equal(row(s.shas.featTested).conflict.conflict, false);
  assert.equal(row(s.shas.featFailed).ci.state, 'failed');
});

test('next hop preview: skipped when the PR conflicts, detected when uat -> prod would conflict', async () => {
  const blocked = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  assert.deepEqual(blocked.nextHop, { env: 'prod', skipped: 'conflict' });
  const none = await analyze({ cwd: s.dir, base: 'prod', head: s.shas.uatEdit, ciLookup: lookupFrom(s.ci) });
  assert.equal(none.nextHop, null);

  const s2 = seed();
  g(s2.dir, 'checkout', '-q', 'prod');
  writeFileSync(path.join(s2.dir, 'search.txt'), 'prod version\n');
  g(s2.dir, 'add', '-A');
  g(s2.dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'prod: add search.txt');
  g(s2.dir, 'update-ref', 'refs/remotes/origin/prod', 'prod');
  const res = await analyze({ cwd: s2.dir, base: 'uat', head: s2.shas.featTested, ciLookup: lookupFrom(s2.ci) });
  assert.equal(res.conflict.conflict, false);
  assert.deepEqual(res.nextHop, { env: 'prod', conflict: true, files: ['search.txt'] });
  assert.ok(res.reasons.some((r) => /Next hop to prod will conflict/.test(r)));
  assert.equal(g(s2.dir, 'status', '--porcelain').trim(), '');
});

test('CI inference: untested commits are tested-by-inference when the next commit with CI passed', async () => {
  const ok = { checkRuns: [{ name: 'build', status: 'completed', conclusion: 'success' }], statuses: [] };
  const lookup = async (sha) => (sha === s.shas.featFailed || sha === s.shas.featConflict ? ok : { checkRuns: [], statuses: [] });
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookup });
  assert.equal(res.counts.untested, 0);
  assert.equal(res.counts.tested, 4);
  assert.equal(res.counts.inferred, 2);
  assert.equal(res.included[0].ci.inferredVia, s.shas.featFailed);
  assert.equal(res.included[2].ci.inferredVia, undefined);
});

test('CI inference never papers over a later failure (strict stays the authority)', async () => {
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  assert.equal(res.included.find((c) => c.sha === s.shas.featUntested).ci.state, 'untested');
});

test('required-checks changes what counts as tested', async () => {
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci), required: ['deploy-preview'] });
  assert.equal(res.counts.tested + res.counts.failed + res.counts.pending, 0);
  assert.equal(res.counts.untested, 4);
});
