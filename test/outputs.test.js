import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/index.js';
import { analyze } from '../src/analyze.js';
import { seed, lookupFrom } from './helpers.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'out-'));
function setup() {
  const dir = tmp();
  const ev = path.join(dir, 'event.json');
  writeFileSync(ev, JSON.stringify({ pull_request: { number: 3, base: { ref: 'uat', repo: { full_name: 'o/r' } }, head: { ref: 'dev', sha: 'a'.repeat(40), repo: { full_name: 'o/r' } } } }));
  const env = { GITHUB_EVENT_PATH: ev, GITHUB_REPOSITORY: 'o/r', GITHUB_WORKSPACE: path.join(dir, 'ws'), GITHUB_OUTPUT: path.join(dir, 'out'), GITHUB_STEP_SUMMARY: path.join(dir, 'sum'), 'INPUT_GITHUB-TOKEN': 't', GITHUB_RUN_ID: '42' };
  writeFileSync(env.GITHUB_OUTPUT, ''); writeFileSync(env.GITHUB_STEP_SUMMARY, '');
  return env;
}
const fetchImpl = async (url, o = {}) => ({ ok: true, status: 200, json: async () => (o.method === 'POST' ? { id: 1 } : []), text: async () => '' });

test('run writes report files, step summary and single-line action outputs', async () => {
  const s = seed();
  const env = setup();
  const analyzeImpl = (a) => analyze({ ...a, cwd: s.dir, head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  const out = await run({ env, fetchImpl, log: () => {}, analyzeImpl });
  assert.equal(out.verdict, 'Blocked');
  const dir = path.join(env.GITHUB_WORKSPACE, 'promotion-gatekeeper-report');
  for (const f of ['report.json', 'ledger.md', 'report.html']) assert.ok(existsSync(path.join(dir, f)), f);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8')).verdict, 'Blocked');
  const outputs = readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().split('\n');
  assert.equal(outputs.length, 3);
  assert.equal(outputs[0], 'verdict=Blocked');
  assert.ok(outputs[1].startsWith('report='));
  assert.equal(JSON.parse(outputs[1].slice(7)).verdict, 'Blocked');
  assert.ok(outputs[2].startsWith('report-path='));
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /Cross-environment ledger/);
});

test('run: a report-write failure logs a warning and does not fail the run', async () => {
  const s = seed();
  const env = setup();
  writeFileSync(env.GITHUB_WORKSPACE, 'a file, not a directory');
  const logs = [];
  const analyzeImpl = (a) => analyze({ ...a, cwd: s.dir, head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  const out = await run({ env, fetchImpl, log: (m) => logs.push(m), analyzeImpl });
  assert.equal(out.verdict, 'Blocked');
  assert.ok(logs.some((l) => /Could not write report files/.test(l)));
});

test('ledger: a backport twin inherits CI from its tested original', async () => {
  const s = seed();
  const res = await analyze({ cwd: s.dir, base: 'uat', head: s.shas.featConflict, ciLookup: lookupFrom(s.ci) });
  const row = res.ledger.find((r) => r.shas.includes(s.shas.fix));
  assert.equal(row.ci.state, 'tested');
  if (row.sha !== s.shas.fix) assert.equal(row.ci.inheritedFrom, s.shas.fix);
});
