import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyze.js';
import { render } from '../src/comment.js';
import { seedDemo } from './seed-demo.js';
import { renderPreview, ledgerMarkdown, htmlPage } from '../src/report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'gatekeeper-demo-'));
const { dir, shas, ci } = seedDemo({ dir: path.join(work, 'repo'), ciPath: path.join(work, 'ci.json') });

const result = await analyze({
  cwd: dir, base: 'uat', head: shas.featConflict, headRef: 'dev', envs: ['dev', 'uat', 'prod'],
  ciLookup: async (sha) => ci[sha] || { checkRuns: [], statuses: [] },
});
const md = render(result, { slug: 'example/demo-app', headSha: result.head });

mkdirSync(path.join(root, 'examples'), { recursive: true });
const mdPath = path.join(root, 'examples', 'sample-comment.md');
writeFileSync(mdPath, md);
renderPreview(mdPath, path.join(root, 'examples', 'preview.html'));
const ledgerMd = ledgerMarkdown(result, { slug: 'example/demo-app' });
writeFileSync(path.join(root, 'examples', 'sample-ledger.md'), ledgerMd);
writeFileSync(path.join(root, 'examples', 'report.html'), htmlPage(`${md}\n${ledgerMd}`, { title: 'Promotion Gatekeeper report', wide: true, header: '<span class="avatar">PG</span><strong>Promotion Gatekeeper</strong><span>cross-environment report</span>' }));

console.log(`Verdict: ${result.verdict} | conflict: ${result.conflict.files.join(', ') || 'none'} | already in target via backport: ${result.equivalentCount} | missing backports: ${result.missingBackports.map((c) => c.subject).join('; ') || 'none'}`);

const problems = [];
if (result.verdict !== 'Blocked') problems.push('verdict is not Blocked');
if (!result.conflict.files.includes('app.txt')) problems.push('app.txt not reported as conflict');
if (result.equivalentCount !== 1) problems.push('expected 1 change already in target via backport');
if (!result.missingBackports.some((c) => c.sha === shas.hotfix)) problems.push('prod hotfix not reported as missing backport');
if (problems.length) { console.error(`DEMO CHECK FAILED: ${problems.join('; ')}`); process.exit(1); }
