import { MARKER } from './comment.js';
import { SELF_CONTEXT } from './analyze.js';

export function createClient({ token, fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com' }) {
  async function request(method, path, body) {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'promotion-gatekeeper',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API ${method} ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }
  return { request };
}

export async function findStickyComment(client, repo, number) {
  for (let page = 1; page < 50; page++) {
    const list = await client.request('GET', `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    // Marker AND bot author: a human pasting the marker cannot hijack (or get overwritten as) the sticky comment.
    const hit = list.find((c) => typeof c.body === 'string' && c.body.includes(MARKER) && c.user?.type === 'Bot');
    if (hit) return hit;
    if (list.length < 100) return null;
  }
  return null;
}

/** Update the marker comment if present, otherwise create it. Never duplicates. */
export async function upsertComment(client, repo, number, body) {
  const existing = await findStickyComment(client, repo, number);
  if (existing) {
    await client.request('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
    return { action: 'updated', id: existing.id };
  }
  const created = await client.request('POST', `/repos/${repo}/issues/${number}/comments`, { body });
  return { action: 'created', id: created?.id };
}

export async function setStatus(client, repo, sha, { state, description }) {
  return client.request('POST', `/repos/${repo}/statuses/${sha}`, {
    state, description: description.slice(0, 140), context: SELF_CONTEXT,
  });
}

/** Real CI lookup via REST. Returns {checkRuns, statuses} for a commit. */
export function createCiLookup(client, repo) {
  return async function ciLookup(sha) {
    const checkRuns = [];
    for (let page = 1; page < 20; page++) {
      const r = await client.request('GET', `/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}&filter=latest`);
      const runs = r?.check_runs || [];
      checkRuns.push(...runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })));
      if (runs.length < 100) break;
    }
    const s = await client.request('GET', `/repos/${repo}/commits/${sha}/status?per_page=100`);
    const statuses = (s?.statuses || []).map((x) => ({ context: x.context, state: x.state }));
    return { checkRuns, statuses };
  };
}
