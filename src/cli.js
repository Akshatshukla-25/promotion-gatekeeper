#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyze } from './analyze.js';
import { render } from './comment.js';
import { resolveSha } from './git.js';
import { ledgerMarkdown } from './report.js';

const USAGE = 'Usage: node src/cli.js --repo <path> --base <branch> --head <rev> --ci fixtures.json [--envs dev,uat,prod] [--slug owner/name] [--required a,b] [--ignore c] [--ledger true]';

export function fixtureLookup(map) {
  return async (sha) => map[sha] || { checkRuns: [], statuses: [] };
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(USAGE);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

const split = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

export async function main(argv = process.argv.slice(2), out = console.log) {
  const a = parseArgs(argv);
  if (!a.repo || !a.base || !a.head || !a.ci) throw new Error(USAGE);
  const result = await analyze({
    cwd: a.repo, base: a.base, head: resolveSha(a.repo, a.head), headRef: a.head,
    envs: split(a.envs || 'dev,uat,prod'),
    ciLookup: fixtureLookup(JSON.parse(readFileSync(a.ci, 'utf8'))),
    required: split(a.required), ignore: split(a.ignore),
  });
  out(render(result, { slug: a.slug, headSha: result.head }));
  if (a.ledger === 'true') out(ledgerMarkdown(result, { slug: a.slug }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
