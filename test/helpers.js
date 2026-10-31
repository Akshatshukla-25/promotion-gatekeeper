import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedDemo } from '../scripts/seed-demo.js';
import { gitOk } from '../src/git.js';

export function seed() {
  const work = mkdtempSync(path.join(tmpdir(), 'gatekeeper-test-'));
  return seedDemo({ dir: path.join(work, 'repo'), ciPath: path.join(work, 'ci.json') });
}
export const lookupFrom = (ci) => async (sha) => ci[sha] || { checkRuns: [], statuses: [] };
const ident = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.x' };
export const g = (dir, ...a) => gitOk(a, { cwd: dir, env: ident });
