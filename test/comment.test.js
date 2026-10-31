import test from 'node:test';
import assert from 'node:assert/strict';
import { render, renderFailure, MARKER, MAX_ROWS } from '../src/comment.js';

const sha = (n) => n.toString(16).padStart(40, '0');
const base = (o = {}) => ({
  base: 'uat', head: sha(1), envs: ['dev', 'uat', 'prod'], equivalentCount: 2,
  counts: { included: 2, tested: 1, untested: 0, pending: 0, failed: 1, unchecked: 0 },
  conflict: { conflict: true, files: ['app.txt'] },
  missingBackports: [{ sha: sha(99), subject: 'hotfix: session', presentIn: ['prod'], missingFrom: ['dev'] }],
  included: [
    { sha: sha(2), subject: 'ok change', ci: { state: 'tested', failed: [], pending: [] } },
    { sha: sha(3), subject: 'bad | change @bob <b>', ci: { state: 'failed', failed: ['test'], pending: [] } },
  ],
  verdict: 'Blocked', reasons: ['Merge conflict in 1 file', '1 change with failing CI'], ...o,
});

test('comment starts with marker and shows verdict, reasons, tables and footer', () => {
  const md = render(base(), { slug: 'o/r' });
  assert.ok(md.startsWith(`${MARKER}\n`));
  assert.match(md, /🛑 Blocked/);
  assert.match(md, /Merge conflict in 1 file/);
  assert.match(md, /Already in target via backport \| 2/);
  assert.match(md, /Conflicting files/);
  assert.match(md, /`app\.txt`/);
  assert.match(md, /Missing backports/);
  assert.match(md, /Advisory, deterministic analysis/);
  assert.ok(md.includes(`https://github.com/o/r/commit/${sha(3)}`));
});

test('untrusted text is escaped (pipes, html, mentions)', () => {
  const md = render(base(), { slug: 'o/r' });
  assert.ok(md.includes('bad \\| change @\u200bbob &lt;b&gt;'));
});

test('problem table is capped at 25 rows', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ sha: sha(100 + i), subject: `c${i}`, ci: { state: 'untested', failed: [], pending: [] } }));
  const md = render(base({ included: many, counts: { included: 40, tested: 0, untested: 40, pending: 0, failed: 0, unchecked: 0 } }));
  const rows = md.split('\n').filter((l) => l.startsWith('| ❔ Untested | `'));
  assert.equal(rows.length, MAX_ROWS);
  assert.match(md, /and 15 more not shown/);
});

test('Ready and Empty comments omit problem sections', () => {
  const md = render(base({ verdict: 'Ready', reasons: ['All good'], conflict: { conflict: false, files: [] }, missingBackports: [], included: [], counts: { included: 0, tested: 0, untested: 0, pending: 0, failed: 0, unchecked: 0 } }));
  assert.match(md, /✅ Ready/);
  assert.doesNotMatch(md, /Changes needing attention|Conflicting files|Missing backports/);
});

test('failure comment carries the marker so it replaces the sticky comment', () => {
  const md = renderFailure('boom');
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /analysis failed/);
  assert.match(md, /boom/);
});

test('markdown in commit subjects is neutralized: [x](http://evil) cannot become a link', () => {
  const evil = { sha: sha(7), subject: '[x](http://evil) **b** _i_ ![img](http://e/p.png)', ci: { state: 'untested', failed: [], pending: [] } };
  const md = render(base({ included: [evil], counts: { included: 1, tested: 0, untested: 1, pending: 0, failed: 0, unchecked: 0 } }), { slug: 'o/r' });
  assert.ok(md.includes('\\[x\\]\\(http://evil\\) \\*\\*b\\*\\* \\_i\\_ \\!\\[img\\]\\(http://e/p.png\\)'));
  assert.ok(!/(^|[^\\])\[x\]\(http:\/\/evil\)/m.test(md));
});

test('header shows source and target branch; GHE server URL is used for links', () => {
  const md = render(base({ headRef: 'feature/x' }), { slug: 'o/r', serverUrl: 'https://ghe.example.com' });
  assert.match(md, /### 🛑 Blocked: `feature\/x` → `uat`/);
  assert.ok(md.includes(`https://ghe.example.com/o/r/commit/${sha(3)}`));
  assert.ok(!md.includes('https://github.com/'));
});

test('next hop, inferred counts and missing-backport locations are rendered', () => {
  const md = render(base({
    nextHop: { env: 'prod', conflict: true, files: ['x.txt'] },
    counts: { included: 2, tested: 1, inferred: 1, untested: 0, pending: 0, failed: 1, unchecked: 0 },
    missingBackports: [{ sha: sha(99), subject: 'hotfix', presentIn: ['prod'], missingFrom: ['dev', 'uat'] }],
  }));
  assert.match(md, /Next hop: `uat` → `prod`/);
  assert.match(md, /would conflict in: `x\.txt`/);
  assert.match(md, /tested by inference/);
  assert.match(md, /in `prod`; missing from `dev`, `uat`/);
});
