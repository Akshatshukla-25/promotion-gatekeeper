import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { main, parseArgs } from '../src/cli.js';
import { seed } from './helpers.js';

let s;
before(() => { s = seed(); });

test('cli is importable without side effects and prints markdown + ledger', async () => {
  const ciPath = path.join(path.dirname(s.dir), 'ci.json');
  writeFileSync(ciPath, JSON.stringify(s.ci));
  const lines = [];
  const res = await main(['--repo', s.dir, '--base', 'uat', '--head', 'dev', '--ci', ciPath, '--ledger', 'true'], (x) => lines.push(x));
  assert.equal(res.verdict, 'Blocked');
  assert.match(lines[0], /^<!-- promotion-gatekeeper -->\n### 🛑 Blocked: `dev` → `uat`/);
  assert.match(lines[1], /Cross-environment ledger/);
});

test('cli rejects bad usage', async () => {
  assert.throws(() => parseArgs(['--repo']));
  await assert.rejects(() => main(['--repo', '.']), /Usage/);
});
