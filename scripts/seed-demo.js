import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitOk } from '../src/git.js';

const ok = (name) => ({ name, status: 'completed', conclusion: 'success' });

/** Build a deterministic demo repo (prod / uat / dev) plus a CI fixtures file. */
export function seedDemo({ dir, ciPath }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let tick = 0;
  const env = () => {
    const d = new Date(Date.UTC(2026, 0, 1, 12, 0, tick++)).toISOString();
    return {
      GIT_AUTHOR_NAME: 'Demo Dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Demo Dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
      GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d,
    };
  };
  const g = (...args) => gitOk(args, { cwd: dir, env: env() });
  const commit = (msg, files) => {
    for (const [f, c] of Object.entries(files)) writeFileSync(path.join(dir, f), c);
    g('add', '-A');
    g('-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', msg);
    return g('rev-parse', 'HEAD').trim();
  };

  const shas = {};
  g('init', '-q', '-b', 'prod');
  commit('Initial commit', { 'app.txt': 'line 1\nline 2\nline 3\n', 'README.md': '# Demo app\n' });
  g('branch', 'uat');
  g('branch', 'dev');

  g('checkout', '-q', 'uat');
  shas.uatEdit = commit('uat: tweak line 2 in app.txt', { 'app.txt': 'line 1\nline 2 (edited on uat)\nline 3\n' });

  g('checkout', '-q', 'dev');
  shas.fix = commit('fix: handle empty input', { 'fix.txt': 'empty input guard\n' });
  shas.featTested = commit('feat: add search box', { 'search.txt': 'search box\n' });
  shas.featUntested = commit('feat: add dark mode toggle', { 'theme.txt': 'dark mode\n' });
  shas.featFailed = commit('feat: add export to CSV', { 'export.txt': 'csv export\n' });
  shas.featConflict = commit('feat: reword line 2 in app.txt', { 'app.txt': 'line 1\nline 2 (edited on dev)\nline 3\n' });

  g('checkout', '-q', 'uat');
  g('cherry-pick', '-x', shas.fix);
  shas.fixOnUat = g('rev-parse', 'HEAD').trim();

  g('checkout', '-q', 'prod');
  shas.hotfix = commit('hotfix: patch session expiry', { 'hotfix.txt': 'session expiry patch\n' });

  for (const b of ['prod', 'uat', 'dev']) g('update-ref', `refs/remotes/origin/${b}`, b);

  const ci = {
    [shas.fix]: { checkRuns: [ok('build'), ok('test')], statuses: [] },
    [shas.featTested]: { checkRuns: [ok('build'), ok('test')], statuses: [] },
    // only the gatekeeper's own check: excluded, so this commit counts as untested
    [shas.featUntested]: { checkRuns: [{ name: 'promotion-gatekeeper', status: 'completed', conclusion: 'failure' }], statuses: [] },
    [shas.featFailed]: { checkRuns: [ok('build'), { name: 'test', status: 'completed', conclusion: 'failure' }], statuses: [] },
    [shas.featConflict]: { checkRuns: [ok('build'), ok('test')], statuses: [] },
  };
  if (ciPath) writeFileSync(ciPath, `${JSON.stringify(ci, null, 2)}\n`);
  return { dir, shas, ci };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = path.resolve(process.argv[2] || '.demo/repo');
  const ciPath = path.resolve(process.argv[3] || '.demo/ci.json');
  mkdirSync(path.dirname(ciPath), { recursive: true });
  const { shas } = seedDemo({ dir, ciPath });
  console.log(`Seeded ${dir}\nCI fixtures: ${ciPath}\n${JSON.stringify(shas, null, 2)}`);
}
