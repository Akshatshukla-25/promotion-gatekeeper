export const MARKER = '<!-- promotion-gatekeeper -->';
export const MAX_ROWS = 25;
const ICONS = { Empty: '⚪', Blocked: '🛑', Caution: '⚠️', Ready: '✅' };
const STATE_LABEL = { failed: '❌ Failed', pending: '⏳ Pending', untested: '❔ Untested', unchecked: '➖ Not checked' };
const ORDER = { failed: 0, pending: 1, untested: 2, unchecked: 3 };

/** Untrusted text inside a code span or plain place: strip what could break out. */
export function escCode(s, max = 100) {
  let t = String(s ?? '').replace(/\r?\n/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/`/g, "'").replace(/@/g, '@\u200b');
}

/** Untrusted text rendered as markdown (commit subjects): also neutralize links, emphasis and images. */
export function esc(s, max = 100) {
  return escCode(s, max).replace(/[[\]()*_!]/g, '\\$&');
}

export function commitLink(sha, slug, serverUrl = 'https://github.com') {
  const short = sha.slice(0, 7);
  return slug ? `[\`${short}\`](${serverUrl}/${slug}/commit/${sha})` : `\`${short}\``;
}

export function ciLabel(ci) {
  if (!ci) return '';
  if (ci.inferredVia) return `✅ inferred (${ci.inferredVia.slice(0, 7)})`;
  const own = { tested: '✅ tested', untested: '❔ untested', pending: '⏳ pending', failed: '❌ failed', unchecked: '➖ not checked' }[ci.state] || '';
  return ci.inheritedFrom ? `${own} (twin ${ci.inheritedFrom.slice(0, 7)})` : own;
}

export function render(result, { slug, headSha, serverUrl = 'https://github.com', runUrl } = {}) {
  const { verdict, reasons, counts, conflict, nextHop, missingBackports, included, equivalentCount, base, head, headRef, envs } = result;
  const title = headRef ? `\`${escCode(headRef)}\` → \`${escCode(base)}\`` : `promoting to \`${escCode(base)}\``;
  const out = [MARKER, `### ${ICONS[verdict]} ${verdict}: ${title}`, ''];
  for (const r of reasons) out.push(`- ${r}`);
  out.push('');

  out.push('| | Changes |', '|---|---:|');
  out.push(`| Included in this promotion | ${counts.included} |`);
  out.push(`| ✅ Tested | ${counts.tested} |`);
  if (counts.inferred) out.push(`| ↳ tested by inference (a later commit passed) | ${counts.inferred} |`);
  out.push(`| ❔ Untested | ${counts.untested} |`);
  out.push(`| ⏳ Pending | ${counts.pending} |`);
  out.push(`| ❌ Failed | ${counts.failed} |`);
  if (counts.unchecked) out.push(`| ➖ Not checked | ${counts.unchecked} |`);
  out.push(`| Already in target via backport | ${equivalentCount} |`, '');

  const problems = included
    .filter((c) => c.ci.state !== 'tested')
    .sort((a, b) => ORDER[a.ci.state] - ORDER[b.ci.state]);
  if (problems.length) {
    out.push('#### Changes needing attention', '');
    out.push('| Status | Commit | Change | Details |', '|---|---|---|---|');
    for (const c of problems.slice(0, MAX_ROWS)) {
      const names = c.ci.state === 'failed' ? c.ci.failed : c.ci.state === 'pending' ? c.ci.pending : [];
      out.push(`| ${STATE_LABEL[c.ci.state]} | ${commitLink(c.sha, slug, serverUrl)} | ${esc(c.subject)} | ${escCode(names.join(', '), 80)} |`);
    }
    if (problems.length > MAX_ROWS) out.push('', `…and ${problems.length - MAX_ROWS} more not shown.`);
    out.push('');
  }

  if (conflict.conflict) {
    out.push('#### Conflicting files', '');
    if (conflict.files.length) for (const f of conflict.files.slice(0, MAX_ROWS)) out.push(`- \`${escCode(f, 200)}\``);
    else out.push('- (conflict reported without file names)');
    out.push('');
  }

  if (nextHop) {
    out.push(`#### Next hop: \`${escCode(base)}\` → \`${escCode(nextHop.env)}\``, '');
    if (nextHop.skipped === 'conflict') out.push('- Not previewed: this promotion already conflicts.');
    else if (nextHop.skipped) out.push('- Preview unavailable.');
    else if (nextHop.conflict) out.push(`- ⚠️ After this merge, promoting to \`${escCode(nextHop.env)}\` would conflict in: ${nextHop.files.map((f) => `\`${escCode(f, 200)}\``).join(', ') || '(unknown files)'}`);
    else out.push(`- ✅ After this merge, promoting to \`${escCode(nextHop.env)}\` merges cleanly.`);
    out.push('');
  }

  if (missingBackports.length) {
    out.push('#### Missing backports (in a higher environment, absent from a lower one)', '');
    for (const c of missingBackports.slice(0, MAX_ROWS)) {
      const where = `in ${c.presentIn.map((e) => `\`${escCode(e)}\``).join(', ')}; missing from ${c.missingFrom.map((e) => `\`${escCode(e)}\``).join(', ')}`;
      out.push(`- ${commitLink(c.sha, slug, serverUrl)} ${esc(c.subject)} (${where})`);
    }
    if (missingBackports.length > MAX_ROWS) out.push(`- …and ${missingBackports.length - MAX_ROWS} more`);
    out.push('');
  }

  const at = headSha || head;
  const ledgerNote = runUrl ? ` Full cross-environment ledger: [run summary](${runUrl}).` : '';
  out.push(`<sub>Advisory, deterministic analysis: no AI involved. Computed for \`${String(at).slice(0, 7)}\`.${ledgerNote}</sub>`, '');
  return out.join('\n');
}

export function renderFailure(message) {
  const safe = String(message ?? 'Unknown error').replace(/```/g, "'''").slice(0, 1500);
  return [MARKER, '### ⚠️ Promotion Gatekeeper: analysis failed', '', '```', safe, '```', '',
    '<sub>Advisory, deterministic analysis. No verdict was produced for this run.</sub>', ''].join('\n');
}
