import { cherry, patchId, cherryPickConflict } from './git.js';

const LABEL = { 2: 'yes', 1: 'equiv', 0: 'no' };

/**
 * Cross-environment ledger: for every change that is not in all environments, where does it live?
 * Presence is 'yes' (commit reachable), 'equiv' (patch-id twin) or 'no'. Twins are merged by patch-id.
 */
export function buildLedger({ cwd, head, envs, remote = 'origin/', includedShas = new Set(), limit = 200 }) {
  const refs = envs.map((e) => `${remote}${e}`);
  const tips = [{ ref: head }, ...envs.map((e, i) => ({ ref: refs[i], env: e }))];
  const rows = new Map();

  for (const t of tips) {
    const lists = envs.map((e, i) => (t.env === e ? null : new Map(cherry(cwd, refs[i], t.ref).map((x) => [x.sha, x]))));
    const seen = new Map();
    for (const l of lists) if (l) for (const [sha, it] of l) if (!seen.has(sha)) seen.set(sha, it.subject);
    for (const [sha, subject] of seen) {
      if (!rows.has(sha)) rows.set(sha, { sha, subject, order: rows.size, rank: Object.fromEntries(envs.map((e) => [e, 0])) });
      const row = rows.get(sha);
      envs.forEach((e, i) => {
        let r = 2;
        if (t.env !== e) {
          const it = lists[i].get(sha);
          r = !it ? 2 : it.mark === '-' ? 1 : 0;
        }
        row.rank[e] = Math.max(row.rank[e], r);
      });
    }
  }

  let all = [...rows.values()];
  const total = all.length;
  if (all.length > limit) {
    const inc = all.filter((r) => includedShas.has(r.sha));
    const rest = all.filter((r) => !includedShas.has(r.sha));
    const n = Math.max(0, limit - inc.length);
    all = [...inc, ...(n ? rest.slice(-n) : [])].sort((a, b) => a.order - b.order);
  }

  const groups = new Map();
  for (const r of all) {
    const key = patchId(cwd, r.sha) || r.sha;
    const isInc = includedShas.has(r.sha);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { sha: r.sha, shas: [r.sha], subject: r.subject, included: isInc, order: r.order, rank: { ...r.rank } });
    } else {
      g.shas.push(r.sha);
      for (const e of envs) g.rank[e] = Math.max(g.rank[e], r.rank[e]);
      if (isInc && !g.included) { g.included = true; g.sha = r.sha; g.subject = r.subject; }
      else if (!g.included) g.sha = r.sha; // newest member represents the group
    }
  }

  const out = [...groups.values()]
    .filter((g) => envs.some((e) => g.rank[e] === 0))
    .sort((a, b) => Number(b.included) - Number(a.included) || a.order - b.order)
    .map((g) => ({
      sha: g.sha, shas: g.shas, subject: g.subject, included: g.included,
      presence: Object.fromEntries(envs.map((e) => [e, LABEL[g.rank[e]]])),
      ci: null, conflict: null,
    }));
  return { rows: out, truncated: Math.max(0, total - all.length) };
}

/** Changes present in a higher environment but absent from a lower one. */
export function deriveBackports(rows, envs) {
  const out = [];
  for (const r of rows) {
    let highest = -1;
    envs.forEach((e, i) => { if (r.presence[e] !== 'no') highest = i; });
    if (highest < 0) continue;
    const missingFrom = envs.filter((e, i) => i < highest && r.presence[e] === 'no');
    if (missingFrom.length) {
      out.push({ sha: r.sha, subject: r.subject, presentIn: envs.filter((e) => r.presence[e] !== 'no'), missingFrom });
    }
  }
  return out;
}

/** For each change, would applying it to the first environment lacking it conflict? */
export function annotateConflicts(cwd, rows, envs, remote = 'origin/', limit = 60) {
  rows.slice(0, limit).forEach((r) => {
    const target = envs.find((e) => r.presence[e] === 'no');
    if (!target) return;
    const res = cherryPickConflict(cwd, `${remote}${target}`, r.sha);
    r.conflict = res ? { env: target, ...res } : null;
  });
}
