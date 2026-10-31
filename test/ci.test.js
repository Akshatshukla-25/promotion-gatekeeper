import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCI } from '../src/analyze.js';

const run = (conclusion, status = 'completed', name = 'job') => ({ name, status, conclusion });
const st = (state, context = 'ci/x') => ({ context, state });

const table = [
  ['no checks at all', {}, 'untested'],
  ['empty arrays', { checkRuns: [], statuses: [] }, 'untested'],
  ['only gatekeeper itself (check run)', { checkRuns: [run('failure', 'completed', 'promotion-gatekeeper')] }, 'untested'],
  ['only gatekeeper itself (status)', { statuses: [st('failure', 'promotion-gatekeeper')] }, 'untested'],
  ['success', { checkRuns: [run('success')] }, 'tested'],
  ['neutral and skipped are fine', { checkRuns: [run('neutral'), run('skipped')] }, 'tested'],
  ['status success', { statuses: [st('success')] }, 'tested'],
  ['failure', { checkRuns: [run('failure')] }, 'failed'],
  ['timed_out', { checkRuns: [run('timed_out')] }, 'failed'],
  ['cancelled', { checkRuns: [run('cancelled')] }, 'failed'],
  ['action_required', { checkRuns: [run('action_required')] }, 'failed'],
  ['startup_failure', { checkRuns: [run('startup_failure')] }, 'failed'],
  ['status failure', { statuses: [st('failure')] }, 'failed'],
  ['status error', { statuses: [st('error')] }, 'failed'],
  ['in_progress', { checkRuns: [run(null, 'in_progress')] }, 'pending'],
  ['queued', { checkRuns: [run(null, 'queued')] }, 'pending'],
  ['status pending', { statuses: [st('pending')] }, 'pending'],
  ['failed beats pending', { checkRuns: [run('failure'), run(null, 'queued')] }, 'failed'],
  ['pending beats success', { checkRuns: [run('success'), run(null, 'in_progress')] }, 'pending'],
  ['gatekeeper ignored next to real success', { checkRuns: [run('success'), run('failure', 'completed', 'promotion-gatekeeper')] }, 'tested'],
];

for (const [name, input, expected] of table) {
  test(`classifyCI: ${name} -> ${expected}`, () => {
    assert.equal(classifyCI(input).state, expected);
  });
}

const opt = (o, input) => classifyCI(input, o).state;
test('ignore-checks removes noisy checks', () => {
  assert.equal(opt({ ignore: ['lint'] }, { checkRuns: [run('success'), run('failure', 'completed', 'lint')] }), 'tested');
  assert.equal(opt({ ignore: ['lint'] }, { checkRuns: [run('failure', 'completed', 'lint')] }), 'untested');
});
test('required-checks: only named checks count, all must be present and passing', () => {
  const r = { required: ['build', 'test'] };
  assert.equal(opt(r, { checkRuns: [run('success', 'completed', 'lint')] }), 'untested');
  assert.equal(opt(r, { checkRuns: [run('success', 'completed', 'build')] }), 'pending');
  assert.equal(opt(r, { checkRuns: [run('success', 'completed', 'build'), run('success', 'completed', 'test')] }), 'tested');
  assert.equal(opt(r, { checkRuns: [run('success', 'completed', 'build'), run('failure', 'completed', 'test')] }), 'failed');
  assert.equal(opt(r, { checkRuns: [run('success', 'completed', 'build'), run('success', 'completed', 'test'), run('failure', 'completed', 'lint')] }), 'tested');
  assert.equal(opt({ required: ['ci/jenkins'] }, { statuses: [st('success', 'ci/jenkins')] }), 'tested');
});
