import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, statusFor } from '../src/analyze.js';

const counts = (o = {}) => ({ included: 3, tested: 3, untested: 0, pending: 0, failed: 0, unchecked: 0, ...o });
const none = { conflict: false, files: [] };
const v = (o) => computeVerdict({ includedCount: 3, counts: counts(), conflict: none, missingBackports: [], envs: ['dev', 'uat', 'prod'], ...o });

test('Empty when nothing to promote', () => {
  assert.equal(v({ includedCount: 0, counts: counts({ included: 0, tested: 0 }) }).verdict, 'Empty');
});
test('Blocked on conflict', () => {
  assert.equal(v({ conflict: { conflict: true, files: ['a.txt'] } }).verdict, 'Blocked');
});
test('Blocked on failed CI', () => {
  assert.equal(v({ counts: counts({ failed: 1, tested: 2 }) }).verdict, 'Blocked');
});
test('Blocked wins over caution and lists all reasons', () => {
  const r = v({ counts: counts({ failed: 1, untested: 1, tested: 1 }), missingBackports: [{ sha: 'x' }] });
  assert.equal(r.verdict, 'Blocked');
  assert.equal(r.reasons.length, 3);
});
test('Caution on untested', () => assert.equal(v({ counts: counts({ untested: 1, tested: 2 }) }).verdict, 'Caution'));
test('Caution on pending', () => assert.equal(v({ counts: counts({ pending: 1, tested: 2 }) }).verdict, 'Caution'));
test('Caution on missing backports', () => assert.equal(v({ missingBackports: [{ sha: 'x' }] }).verdict, 'Caution'));
test('Ready when everything is tested and clean', () => {
  const r = v();
  assert.equal(r.verdict, 'Ready');
  assert.ok(r.reasons.length >= 1);
});

test('commit status: Blocked is advisory unless block-on-blocked', () => {
  const blocked = { verdict: 'Blocked', reasons: ['Merge conflict in 1 file'], counts: counts() };
  assert.deepEqual(statusFor(blocked, false), { state: 'success', description: 'Blocked (advisory)' });
  assert.equal(statusFor(blocked, true).state, 'failure');
  assert.ok(statusFor({ ...blocked, verdict: 'Ready' }, true).state === 'success');
});

test('Caution when the next hop would conflict', () => {
  const r = v({ nextHop: { env: 'prod', conflict: true, files: ['a'] } });
  assert.equal(r.verdict, 'Caution');
  assert.match(r.reasons[0], /Next hop to prod will conflict/);
  assert.equal(v({ nextHop: { env: 'prod', conflict: false, files: [] } }).verdict, 'Ready');
  assert.equal(v({ nextHop: { env: 'prod', skipped: 'conflict' } }).verdict, 'Ready');
});
