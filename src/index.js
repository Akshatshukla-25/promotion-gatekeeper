import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze, statusFor } from './analyze.js';
import { render, renderFailure } from './comment.js';
import { createClient, createCiLookup, upsertComment, setStatus } from './github.js';
import { htmlPage, ledgerMarkdown } from './report.js';

const input = (env, name) => (env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`] || '').trim();
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function writeReports({ env, result, comment, ledgerMd }) {
  const outputs = [];
  const compact = JSON.stringify({
    verdict: result.verdict, reasons: result.reasons, counts: result.counts,
    conflict: { conflict: result.conflict.conflict, files: result.conflict.files },
    nextHop: result.nextHop || null, missingBackports: result.missingBackports.length, ledgerRows: (result.ledger || []).length,
  });
  const ws = env.GITHUB_WORKSPACE;
  const dirInput = input(env, 'report-dir');
  let dir = '';
  if (ws || dirInput) {
    dir = path.resolve(ws || process.cwd(), dirInput || 'promotion-gatekeeper-report');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(path.join(dir, 'ledger.md'), `${comment}\n${ledgerMd}\n`);
    writeFileSync(path.join(dir, 'report.html'), htmlPage(`${comment}\n${ledgerMd}`, { title: 'Promotion Gatekeeper report', wide: true, header: '<span class="avatar">PG</span><strong>Promotion Gatekeeper</strong><span>cross-environment report</span>' }));
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${comment}\n${ledgerMd}\n`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `verdict=${result.verdict}\nreport=${compact}\nreport-path=${dir}\n`);
  return outputs;
}

async function processPR(pr, ctx) {
  const { env, repo, token, log, client, analyzeImpl } = ctx;
  const envs = list(input(env, 'environments') || 'dev,uat,prod');
  const base = pr.base.ref;
  if (!envs.includes(base)) { log(`Base branch "${base}" is not an environment branch; skipping.`); return { skipped: 'not-env' }; }
  if (!pr.head.repo || pr.head.repo.full_name !== pr.base.repo.full_name) {
    log('Fork pull request; skipping (token is read-only).');
    return { skipped: 'fork' };
  }
  const blockOnBlocked = input(env, 'block-on-blocked').toLowerCase() === 'true';
  const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';
  const runUrl = env.GITHUB_RUN_ID ? `${serverUrl}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  try {
    const result = await analyzeImpl({
      cwd: env.GITHUB_WORKSPACE || process.cwd(), base, head: pr.head.sha, headRef: pr.head.ref, envs,
      ciLookup: createCiLookup(client, repo),
      required: list(input(env, 'required-checks')), ignore: list(input(env, 'ignore-checks')),
    });
    const body = render(result, { slug: repo, headSha: pr.head.sha, serverUrl, runUrl });
    const upsert = await upsertComment(client, repo, pr.number, body);
    const status = statusFor(result, blockOnBlocked);
    await setStatus(client, repo, pr.head.sha, status);
    try {
      writeReports({ env, result, comment: body, ledgerMd: ledgerMarkdown(result, { slug: repo, serverUrl }) });
    } catch (e) { log(`::warning::Could not write report files: ${String(e.message).split(token || '\u0000').join('***')}`); }
    log(`Verdict: ${result.verdict} (comment ${upsert.action}, status ${status.state}).`);
    return { verdict: result.verdict, status, upsert };
  } catch (err) {
    const msg = String(err?.message || err).split(token || '\u0000').join('***');
    log(`::warning::Promotion Gatekeeper analysis failed: ${msg}`);
    try { await upsertComment(client, repo, pr.number, renderFailure(msg)); } catch { /* best effort */ }
    // A required check must never hang forever: report an error status as well.
    try { await setStatus(client, repo, pr.head.sha, { state: 'error', description: 'Analysis failed' }); } catch { /* best effort */ }
    return { error: msg };
  }
}

/** workflow_run: re-analyze open same-repo PRs whose head is the commit that just finished CI. */
async function prsFromWorkflowRun(event, client, repo) {
  const wr = event.workflow_run;
  if (!wr?.head_repository || wr.head_repository.full_name !== repo) return [];
  let nums = (wr.pull_requests || []).map((p) => p.number);
  if (!nums.length) {
    const q = encodeURIComponent(`${wr.head_repository.owner.login}:${wr.head_branch}`);
    nums = (await client.request('GET', `/repos/${repo}/pulls?state=open&head=${q}`)).map((p) => p.number);
  }
  const prs = [];
  for (const n of nums) {
    const p = await client.request('GET', `/repos/${repo}/pulls/${n}`);
    // Only the checked-out commit can be analyzed; a newer push will trigger its own run.
    if (p.state === 'open' && p.head.sha === wr.head_sha) prs.push(p);
  }
  return prs;
}

export async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, analyzeImpl = analyze } = {}) {
  const token = input(env, 'github-token') || env.GITHUB_TOKEN || '';
  const repo = env.GITHUB_REPOSITORY;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const client = createClient({ token, fetchImpl, apiUrl: env.GITHUB_API_URL || 'https://api.github.com' });
  const ctx = { env, repo, token, log, client, analyzeImpl };

  if (event.pull_request) return processPR(event.pull_request, ctx);
  if (event.workflow_run) {
    const prs = await prsFromWorkflowRun(event, client, repo);
    if (!prs.length) { log('No matching open pull request for this workflow run; nothing to do.'); return { skipped: 'no-pr' }; }
    const results = [];
    for (const p of prs) results.push(await processPR(p, ctx));
    return { results };
  }
  log('Unsupported event; nothing to do.');
  return { skipped: 'not-a-pr' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.log(`::error::${String(e?.message || e)}`); process.exitCode = 1; });
}
