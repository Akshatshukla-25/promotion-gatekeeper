import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, htmlPage, ledgerMarkdown } from '../src/report.js';
import { render, esc, escCode } from '../src/comment.js';

const sha = (n) => n.toString(16).padStart(40, '0');
const hostile = [
  'x \u000160\u0002img src=x onerror=alert(1)\u000162\u0002',
  '<script>alert(1)</script>',
  '"onmouseover="alert(1)',
  '[a](javascript:alert(1)) [b](https://ok.example/"onclick="x)',
  '`code` | pipe \u0000 nul \u007f del',
];
const result = (subject) => ({
  base: 'uat', head: sha(1), headRef: subject, envs: ['dev', 'uat', 'prod'], equivalentCount: 0,
  counts: { included: 1, tested: 0, untested: 1, pending: 0, failed: 0, unchecked: 0 },
  conflict: { conflict: true, files: [subject] }, nextHop: null,
  missingBackports: [{ sha: sha(9), subject, presentIn: ['prod'], missingFrom: ['dev'] }],
  included: [{ sha: sha(2), subject, ci: { state: 'untested', failed: [], pending: [] } }],
  ledger: [{ sha: sha(2), shas: [sha(2)], subject, included: true, presence: { dev: 'yes', uat: 'no', prod: 'no' }, ci: { state: 'untested' }, conflict: { env: 'uat', conflict: true, files: [subject] } }],
  verdict: 'Blocked', reasons: ['Merge conflict in 1 file'],
});

for (const h of hostile) {
  test(`report.html neutralizes hostile data: ${JSON.stringify(h).slice(0, 40)}`, () => {
    const r = result(h);
    const md = `${render(r, { slug: 'o/r' })}\n${ledgerMarkdown(r, { slug: 'o/r' })}`;
    const html = htmlPage(md, { title: h });
    const body = html.slice(html.indexOf('<div class="body">'));
    assert.ok(!/<script/i.test(body), 'no script tag');
    assert.ok(!/<img/i.test(body), 'no img tag');
    assert.ok(!/<[a-z][^>]*\son[a-z]+=/i.test(body), 'no event-handler attributes');
    assert.ok(!/href="javascript:/i.test(body), 'no javascript: links');
    assert.ok(!/[\u0000-\u0008\u000B-\u001F\u007F]/.test(html), 'no control characters');
    assert.ok(!/<title>[^<]*<[a-z]/i.test(html), 'title is escaped');
  });
}

test('escCode and esc strip control characters', () => {
  assert.equal(escCode('a\u0001b\u0002c\u0000'), 'abc');
  assert.equal(esc('a\u0001b'), 'ab');
});

test('markdownToHtml: tables, lists, headings, code fences, footer', () => {
  const html = markdownToHtml('### T\n\n- a\n- b\n\n| h1 | h2 |\n|---|---:|\n| x | y |\n\n```\n<raw>\n```\n\n<sub>foot</sub>');
  assert.match(html, /<h3>T<\/h3>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<th class="r">h2<\/th>/);
  assert.match(html, /<pre><code>&lt;raw&gt;/);
  assert.match(html, /<p class="footer">foot<\/p>/);
});

test('ledgerMarkdown renders presence, CI and cherry-pick columns; empty ledger message', () => {
  const md = ledgerMarkdown(result('feat: x'), { slug: 'o/r' });
  assert.match(md, /\| ▶ \| feat: x/);
  assert.match(md, /conflicts on uat/);
  assert.match(ledgerMarkdown({ envs: ['dev', 'prod'], ledger: [] }), /Every change is present in every environment/);
});
