import { spawnSync } from 'node:child_process';

export function git(args, { cwd, env, input } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...(env || {}) },
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

export function gitOk(args, opts) {
  const r = git(args, opts);
  if (r.code !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${r.code}): ${r.stderr.trim()}`);
  }
  return r.stdout;
}

export function resolveSha(cwd, rev) {
  return gitOk(['rev-parse', '--verify', `${rev}^{commit}`], { cwd }).trim();
}

/** Parse `git cherry -v` output: "+ <sha> <subject>" / "- <sha> <subject>". */
export function parseCherry(out) {
  const items = [];
  for (const line of out.split('\n')) {
    const m = /^([+-]) ([0-9a-f]{40})(?: (.*))?$/.exec(line);
    if (m) items.push({ mark: m[1], sha: m[2], subject: m[3] || '' });
  }
  return items;
}

export function cherry(cwd, upstream, head) {
  return parseCherry(gitOk(['cherry', '-v', upstream, head], { cwd }));
}

/** Stable patch-id of one commit ('' for merges/empty commits). */
export function patchId(cwd, sha) {
  const d = git(['diff-tree', '-p', '--root', '--no-commit-id', sha], { cwd });
  if (d.code !== 0 || !d.stdout) return '';
  const p = git(['patch-id', '--stable'], { cwd, input: d.stdout });
  return p.code === 0 ? p.stdout.trim().split(/\s+/)[0] || '' : '';
}

/**
 * Dry-run merge using git merge-tree (never touches the working tree or index).
 * Exit 0 = clean, 1 = conflict (lines after the first are file names), other = error.
 * Returns the result tree id as `tree` (first output line, also present on conflict).
 */
export function mergeTree(cwd, base, head, { mergeBase } = {}) {
  const args = ['merge-tree', '--write-tree', '--name-only', '--no-messages'];
  if (mergeBase) args.push(`--merge-base=${mergeBase}`);
  args.push(base, head);
  const r = git(args, { cwd });
  const first = r.stdout.split('\n')[0].trim();
  if (r.code === 0) return { conflict: false, files: [], tree: first };
  // Exit 1 also happens for unmergeable refs; a real conflict always prints the result tree OID first.
  if (r.code === 1 && /^[0-9a-f]{40,64}$/.test(first)) {
    const files = [...new Set(r.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean))];
    return { conflict: true, files, tree: first };
  }
  throw new Error(`git merge-tree failed (exit ${r.code}): ${r.stderr.trim() || 'no output'}`);
}

/** Simulate cherry-picking `sha` onto `target` without touching the working tree. null = cannot tell. */
export function cherryPickConflict(cwd, target, sha) {
  try {
    const r = mergeTree(cwd, target, sha, { mergeBase: `${sha}^` });
    return { conflict: r.conflict, files: r.files };
  } catch {
    return null;
  }
}

/** Write a commit object (no ref, no working tree) so merge-tree can preview a next hop. */
export function commitTree(cwd, tree, parents, message) {
  const env = {
    GIT_AUTHOR_NAME: 'promotion-gatekeeper', GIT_AUTHOR_EMAIL: 'noreply@example.invalid',
    GIT_COMMITTER_NAME: 'promotion-gatekeeper', GIT_COMMITTER_EMAIL: 'noreply@example.invalid',
  };
  return gitOk(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message], { cwd, env }).trim();
}
