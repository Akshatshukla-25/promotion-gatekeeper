import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, upsertComment, setStatus, createCiLookup } from '../src/github.js';
import { MARKER } from '../src/comment.js';
import { run } from '../src/index.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function mockGitHub(initial = []) {
  const comments = [...initial];
  const calls = [];
  let nextId = 1000;
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    calls.push({ method, path: u.pathname, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers });
    let m;
    if (method === 'GET' && (m = /\/issues\/\d+\/comments$/.exec(u.pathname))) {
      const page = Number(u.searchParams.get('page') || 1);
      return json(comments.slice((page - 1) * 100, page * 100));
    }
    if (method === 'POST' && /\/issues\/\d+\/comments$/.test(u.pathname)) {
      const c = { id: nextId++, body: JSON.parse(opts.body).body, user: { type: 'Bot', login: 'github-actions[bot]' } };
      comments.push(c);
      return json(c, 201);
    }
    if (method === 'PATCH' && (m = /\/issues\/comments\/(\d+)$/.exec(u.pathname))) {
      const c = comments.find((x) => x.id === Number(m[1]));
      c.body = JSON.parse(opts.body).body;
      return json(c);
    }
    if (method === 'POST' && /\/statuses\//.test(u.pathname)) return json({}, 201);
    return json({ message: 'not found' }, 404);
  };
  return { fetchImpl, comments, calls };
}

test('first run creates exactly one comment', async () => {
  const gh = mockGitHub([{ id: 1, body: 'unrelated' }]);
  const client = createClient({ token: 't', fetchImpl: gh.fetchImpl });
  const r = await upsertComment(client, 'o/r', 5, `${MARKER}\nv1`);
  assert.equal(r.action, 'created');
  assert.equal(gh.comments.filter((c) => c.body.includes(MARKER)).length, 1);
});

test('second run updates the marker comment in place (never duplicates)', async () => {
  const gh = mockGitHub([{ id: 1, body: 'unrelated' }, { id: 2, body: `${MARKER}\nold`, user: { type: 'Bot' } }]);
  const client = createClient({ token: 't', fetchImpl: gh.fetchImpl });
  const r1 = await upsertComment(client, 'o/r', 5, `${MARKER}\nnew`);
  const r2 = await upsertComment(client, 'o/r', 5, `${MARKER}\nnewer`);
  assert.deepEqual([r1.action, r1.id, r2.action, r2.id], ['updated', 2, 'updated', 2]);
  assert.equal(gh.comments.length, 2);
  assert.equal(gh.comments[1].body, `${MARKER}\nnewer`);
  assert.equal(gh.calls.filter((c) => c.method === 'POST').length, 0);
});

test('finds the marker comment on a later page', async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, body: i === 120 ? `${MARKER}\nold` : 'x', user: { type: 'Bot' } }));
  const gh = mockGitHub(many);
  const client = createClient({ token: 't', fetchImpl: gh.fetchImpl });
  const r = await upsertComment(client, 'o/r', 5, `${MARKER}\nnew`);
  assert.deepEqual([r.action, r.id], ['updated', 121]);
});

test('API errors throw without leaking the token', async () => {
  const client = createClient({ token: 'sekrit', fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) });
  await assert.rejects(() => client.request('GET', '/x'), (e) => !e.message.includes('sekrit') && /403/.test(e.message));
});

test('setStatus posts the gatekeeper context', async () => {
  const gh = mockGitHub();
  const client = createClient({ token: 't', fetchImpl: gh.fetchImpl });
  await setStatus(client, 'o/r', 'abc', { state: 'success', description: 'Blocked (advisory)' });
  const call = gh.calls.at(-1);
  assert.equal(call.path, '/repos/o/r/statuses/abc');
  assert.deepEqual(call.body, { state: 'success', description: 'Blocked (advisory)', context: 'promotion-gatekeeper' });
});

test('createCiLookup normalizes check-runs and statuses', async () => {
  const fetchImpl = async (url) => {
    const body = url.includes('/check-runs')
      ? { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', id: 1 }] }
      : { state: 'failure', statuses: [{ context: 'ci/x', state: 'failure', id: 2 }] };
    return { ok: true, status: 200, json: async () => body };
  };
  const lookup = createCiLookup(createClient({ token: 't', fetchImpl }), 'o/r');
  assert.deepEqual(await lookup('abc'), {
    checkRuns: [{ name: 'build', status: 'completed', conclusion: 'success' }],
    statuses: [{ context: 'ci/x', state: 'failure' }],
  });
});

function eventFile(pr) {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'ev-')), 'event.json');
  writeFileSync(f, JSON.stringify({ pull_request: pr }));
  return f;
}
const pr = (o = {}) => ({ number: 7, base: { ref: 'uat', repo: { full_name: 'o/r' } }, head: { sha: 'a'.repeat(40), repo: { full_name: 'o/r' } }, ...o });

test('run: skips non-environment base branches and fork PRs', async () => {
  const log = () => {};
  const a = await run({ env: { GITHUB_EVENT_PATH: eventFile(pr({ base: { ref: 'feature', repo: { full_name: 'o/r' } } })), GITHUB_REPOSITORY: 'o/r' }, log, fetchImpl: async () => { throw new Error('no calls expected'); } });
  assert.equal(a.skipped, 'not-env');
  const b = await run({ env: { GITHUB_EVENT_PATH: eventFile(pr({ head: { sha: 'b'.repeat(40), repo: { full_name: 'fork/r' } } })), GITHUB_REPOSITORY: 'o/r' }, log, fetchImpl: async () => { throw new Error('no calls expected'); } });
  assert.equal(b.skipped, 'fork');
});

test('run: on error posts an "analysis failed" comment and does not leak the token', async () => {
  const gh = mockGitHub();
  const logs = [];
  const res = await run({
    env: { GITHUB_EVENT_PATH: eventFile(pr()), GITHUB_REPOSITORY: 'o/r', 'INPUT_GITHUB-TOKEN': 'sekrit-token' },
    fetchImpl: gh.fetchImpl, log: (m) => logs.push(m),
    analyzeImpl: async () => { throw new Error('boom sekrit-token'); },
  });
  assert.match(res.error, /boom \*\*\*/);
  assert.equal(gh.comments.length, 1);
  assert.match(gh.comments[0].body, /analysis failed/);
  assert.ok(!gh.comments[0].body.includes('sekrit-token'));
  assert.ok(!logs.join('\n').includes('sekrit-token'));
});

test('run: happy path writes one comment and a commit status', async () => {
  const gh = mockGitHub();
  const result = {
    base: 'uat', head: 'a'.repeat(40), envs: ['dev', 'uat', 'prod'], included: [], equivalentCount: 0,
    counts: { included: 0, tested: 0, untested: 0, pending: 0, failed: 0, unchecked: 0 },
    conflict: { conflict: false, files: [] }, missingBackports: [], verdict: 'Empty', reasons: ['Nothing'],
  };
  const out = await run({
    env: { GITHUB_EVENT_PATH: eventFile(pr()), GITHUB_REPOSITORY: 'o/r', 'INPUT_GITHUB-TOKEN': 't' },
    fetchImpl: gh.fetchImpl, log: () => {}, analyzeImpl: async () => result,
  });
  assert.equal(out.verdict, 'Empty');
  assert.equal(gh.comments.length, 1);
  assert.ok(gh.calls.some((c) => c.path === `/repos/o/r/statuses/${'a'.repeat(40)}`));
});

test('a human comment containing the marker is neither updated nor trusted as the sticky comment', async () => {
  const gh = mockGitHub([{ id: 1, body: `${MARKER}\nspoofed by a human`, user: { type: 'User', login: 'mallory' } }]);
  const client = createClient({ token: 't', fetchImpl: gh.fetchImpl });
  const r = await upsertComment(client, 'o/r', 5, `${MARKER}\nreal`);
  assert.equal(r.action, 'created');
  assert.equal(gh.comments[0].body, `${MARKER}\nspoofed by a human`);
  assert.equal(gh.comments.length, 2);
  const r2 = await upsertComment(client, 'o/r', 5, `${MARKER}\nreal v2`);
  assert.deepEqual([r2.action, r2.id], ['updated', r.id]);
  assert.equal(gh.comments.length, 2);
});

test('run: an analysis failure also sets an error commit status; GHE api url is honored', async () => {
  const gh = mockGitHub();
  let urls = [];
  const wrapped = async (url, o) => { urls.push(url); return gh.fetchImpl(url, o); };
  await run({
    env: { GITHUB_EVENT_PATH: eventFile(pr()), GITHUB_REPOSITORY: 'o/r', 'INPUT_GITHUB-TOKEN': 't', GITHUB_API_URL: 'https://ghe.example.com/api/v3' },
    fetchImpl: wrapped, log: () => {}, analyzeImpl: async () => { throw new Error('nope'); },
  });
  const st = gh.calls.find((c) => /\/statuses\//.test(c.path));
  assert.deepEqual([st.body.state, st.body.context], ['error', 'promotion-gatekeeper']);
  assert.ok(urls.every((u) => u.startsWith('https://ghe.example.com/api/v3/')));
});

test('run: workflow_run re-analyzes only the open same-repo PR at the finished commit', async () => {
  const gh = mockGitHub();
  const sha = 'c'.repeat(40);
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url);
    if (o.method === 'GET' && u.pathname === '/repos/o/r/pulls/7') {
      return { ok: true, status: 200, json: async () => pr({ state: 'open', head: { sha, ref: 'dev', repo: { full_name: 'o/r' } } }) };
    }
    return gh.fetchImpl(url, o);
  };
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'ev-')), 'event.json');
  writeFileSync(f, JSON.stringify({ workflow_run: { head_sha: sha, head_branch: 'dev', head_repository: { full_name: 'o/r', owner: { login: 'o' } }, pull_requests: [{ number: 7 }] } }));
  const out = await run({ env: { GITHUB_EVENT_PATH: f, GITHUB_REPOSITORY: 'o/r', 'INPUT_GITHUB-TOKEN': 't' }, fetchImpl, log: () => {}, analyzeImpl: async () => { throw new Error('x'); } });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].error, 'x');
  // a fork run is skipped
  writeFileSync(f, JSON.stringify({ workflow_run: { head_sha: sha, head_repository: { full_name: 'fork/r' }, pull_requests: [] } }));
  const skip = await run({ env: { GITHUB_EVENT_PATH: f, GITHUB_REPOSITORY: 'o/r' }, fetchImpl, log: () => {} });
  assert.equal(skip.skipped, 'no-pr');
});
