import { cherry, mergeTree, commitTree } from './git.js';
import { buildLedger, deriveBackports, annotateConflicts } from './ledger.js';

export const SELF_CONTEXT = 'promotion-gatekeeper';
export const FAILED_CONCLUSIONS = new Set([
  'failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure',
]);
const FAILED_STATUS_STATES = new Set(['failure', 'error']);

/**
 * Classify CI for one commit (strict, per commit).
 * options.required: only these check names/contexts count (all must be present and passing).
 * options.ignore: check names/contexts to disregard (the Action's own context is always ignored).
 * @returns {{state:'failed'|'pending'|'untested'|'tested', failed:string[], pending:string[]}}
 */
export function classifyCI(ci, { required = [], ignore = [] } = {}) {
  const skip = new Set([SELF_CONTEXT, ...ignore]);
  let runs = (ci?.checkRuns || []).filter((c) => !skip.has(c.name));
  let statuses = (ci?.statuses || []).filter((s) => !skip.has(s.context));
  const missing = [];
  if (required.length) {
    const has = (n) => runs.some((r) => r.name === n) || statuses.some((s) => s.context === n);
    const present = required.filter(has);
    if (present.length === 0) return { state: 'untested', failed: [], pending: [] };
    runs = runs.filter((r) => required.includes(r.name));
    statuses = statuses.filter((s) => required.includes(s.context));
    for (const n of required) if (!has(n)) missing.push(`${n} (missing)`);
  } else if (runs.length === 0 && statuses.length === 0) {
    return { state: 'untested', failed: [], pending: [] };
  }

  const failed = [];
  const pending = [...missing];
  for (const r of runs) {
    if (r.status !== 'completed') pending.push(r.name);
    else if (FAILED_CONCLUSIONS.has(r.conclusion)) failed.push(r.name);
  }
  for (const s of statuses) {
    if (FAILED_STATUS_STATES.has(s.state)) failed.push(s.context);
    else if (s.state === 'pending') pending.push(s.context);
  }
  if (failed.length) return { state: 'failed', failed, pending };
  if (pending.length) return { state: 'pending', failed, pending };
  return { state: 'tested', failed, pending };
}

/**
 * CI usually runs on the pushed tip only. An untested commit counts as tested (marked inferred)
 * when the next commit in the range that has any CI result passed. Strict classification stays the authority.
 */
export function inferTested(commits) {
  const strict = commits.map((c) => c.ci.state);
  commits.forEach((c, i) => {
    if (strict[i] !== 'untested') return;
    for (let j = i + 1; j < commits.length; j++) {
      if (strict[j] === 'untested' || strict[j] === 'unchecked') continue;
      if (strict[j] === 'tested') c.ci = { state: 'tested', failed: [], pending: [], inferredVia: commits[j].sha };
      break;
    }
  });
}

const CI_RANK = { failed: 4, pending: 3, tested: 2, untested: 1, unchecked: 0 };

/** Combine CI of a change and its patch-id twins: failed > pending > tested > untested > unchecked. */
export function mergeTwinCi(members, ownSha) {
  const best = members.reduce((a, b) => (CI_RANK[b.ci.state] > CI_RANK[a.ci.state] ? b : a));
  return best.sha === ownSha ? best.ci : { ...best.ci, inheritedFrom: best.sha };
}

/** Pure verdict logic. */
export function computeVerdict({ includedCount, counts, conflict, missingBackports, nextHop, envs = ['dev', 'prod'] }) {
  if (includedCount === 0) {
    return { verdict: 'Empty', reasons: ['Nothing to promote: the target already contains every change.'] };
  }
  const blockers = [];
  const cautions = [];
  if (conflict?.conflict) {
    const n = conflict.files.length;
    blockers.push(`Merge conflict${n ? ` in ${n} file${n === 1 ? '' : 's'}` : ''}`);
  }
  if (counts.failed > 0) blockers.push(`${counts.failed} change${counts.failed === 1 ? '' : 's'} with failing CI`);
  if (counts.untested > 0) cautions.push(`${counts.untested} untested change${counts.untested === 1 ? '' : 's'} (no CI results)`);
  if (counts.pending > 0) cautions.push(`${counts.pending} change${counts.pending === 1 ? '' : 's'} with CI still pending`);
  if (counts.unchecked > 0) cautions.push(`CI not checked for ${counts.unchecked} change${counts.unchecked === 1 ? '' : 's'} (100-commit limit)`);
  if (missingBackports.length > 0) {
    const n = missingBackports.length;
    cautions.push(`${n} change${n === 1 ? '' : 's'} missing backports to lower environments`);
  }
  if (nextHop?.conflict) {
    const n = nextHop.files.length;
    cautions.push(`Next hop to ${nextHop.env} will conflict${n ? ` in ${n} file${n === 1 ? '' : 's'}` : ''}`);
  }
  const reasons = [...blockers, ...cautions];
  if (blockers.length) return { verdict: 'Blocked', reasons };
  if (cautions.length) return { verdict: 'Caution', reasons };
  return {
    verdict: 'Ready',
    reasons: [`All ${includedCount} change${includedCount === 1 ? '' : 's'} have passing CI, no conflicts, no missing backports.`],
  };
}

function previewNextHop({ cwd, base, head, envs, remote, conflict }) {
  const next = envs[envs.indexOf(base) + 1];
  if (!next) return null;
  if (conflict.conflict) return { env: next, skipped: 'conflict' };
  try {
    const merged = commitTree(cwd, conflict.tree, [`${remote}${base}`, head], 'promotion-gatekeeper preview');
    const r = mergeTree(cwd, `${remote}${next}`, merged);
    return { env: next, conflict: r.conflict, files: r.files };
  } catch {
    return { env: next, skipped: 'error' };
  }
}

export async function analyze({
  cwd, base, head, headRef, envs = ['dev', 'uat', 'prod'], ciLookup,
  remote = 'origin/', maxCommits = 100, batchSize = 10, required = [], ignore = [], ledgerLimit = 200,
}) {
  const baseRef = `${remote}${base}`;
  const items = cherry(cwd, baseRef, head);
  const included = items.filter((i) => i.mark === '+').map(({ sha, subject }) => ({ sha, subject, ci: null }));
  const equivalentCount = items.filter((i) => i.mark === '-').length;
  const classify = (ci) => classifyCI(ci, { required, ignore });

  const cache = new Map();
  const lookup = (sha) => {
    if (!cache.has(sha)) cache.set(sha, Promise.resolve(ciLookup(sha)));
    return cache.get(sha);
  };
  const fillBatches = async (list) => {
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((c) => lookup(c.sha)));
      batch.forEach((c, j) => { c.ci = classify(results[j]); });
    }
  };

  await fillBatches(included.slice(0, maxCommits));
  for (const c of included.slice(maxCommits)) c.ci = { state: 'unchecked', failed: [], pending: [] };
  inferTested(included);

  const count = (s) => included.filter((c) => c.ci.state === s).length;
  const counts = {
    included: included.length,
    tested: count('tested'),
    inferred: included.filter((c) => c.ci.inferredVia).length,
    untested: count('untested'),
    pending: count('pending'),
    failed: count('failed'),
    unchecked: count('unchecked'),
  };

  const conflict = included.length ? mergeTree(cwd, baseRef, head) : { conflict: false, files: [], tree: '' };
  const nextHop = included.length ? previewNextHop({ cwd, base, head, envs, remote, conflict }) : null;

  // Cross-environment ledger (also yields missing backports for every environment pair).
  let ledger = [];
  let ledgerTruncated = 0;
  let missingBackports = [];
  if (envs.length >= 2) {
    const includedShas = new Set(included.map((c) => c.sha));
    const built = buildLedger({ cwd, head, envs, remote, includedShas, limit: ledgerLimit });
    ledger = built.rows;
    ledgerTruncated = built.truncated;
    const byIncluded = new Map(included.map((c) => [c.sha, c.ci]));
    const need = [];
    for (const r of ledger) {
      if (byIncluded.has(r.sha)) r.ci = byIncluded.get(r.sha);
      else need.push(r);
    }
    const budget = Math.max(0, maxCommits - cache.size);
    await fillBatches(need.slice(0, budget));
    for (const r of need.slice(budget)) r.ci = { state: 'unchecked', failed: [], pending: [] };
    for (const r of ledger) {
      if (!r.shas || r.shas.length < 2 || !r.ci) continue;
      const members = [{ sha: r.sha, ci: r.ci }];
      for (const sha of r.shas) {
        if (sha === r.sha || !(cache.has(sha) || cache.size < maxCommits)) continue;
        members.push({ sha, ci: classify(await lookup(sha)) });
      }
      r.ci = mergeTwinCi(members, r.sha);
    }
    annotateConflicts(cwd, ledger, envs, remote);
    missingBackports = deriveBackports(ledger, envs);
  }

  const { verdict, reasons } = computeVerdict({
    includedCount: included.length, counts, conflict, missingBackports, nextHop, envs,
  });
  return {
    base, head, headRef, envs, included, equivalentCount, counts, conflict, nextHop,
    missingBackports, ledger, ledgerTruncated, verdict, reasons,
  };
}

/** Commit status payload for a result. */
export function statusFor(result, blockOnBlocked = false) {
  const { verdict, reasons, counts } = result;
  const clip = (s) => (s.length > 140 ? `${s.slice(0, 137)}...` : s);
  switch (verdict) {
    case 'Blocked':
      return blockOnBlocked
        ? { state: 'failure', description: clip(`Blocked: ${reasons.join('; ')}`) }
        : { state: 'success', description: 'Blocked (advisory)' };
    case 'Caution':
      return { state: 'success', description: clip(`Caution: ${reasons.join('; ')}`) };
    case 'Ready':
      return { state: 'success', description: clip(`Ready: ${counts.included} change(s) tested`) };
    default:
      return { state: 'success', description: 'Nothing to promote' };
  }
}
