import { readFileSync, writeFileSync } from 'node:fs';
import { esc, commitLink, ciLabel } from './comment.js';

const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
const escapeHtml = (s) => clean(s).replace(/&(?!(?:lt|gt|amp|quot|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => escapeHtml(s)
  .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, (_, c) => `\u0001${c.charCodeAt(0)}\u0002`)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>')
  .replace(/\u0001(\d+)\u0002/g, (_, n) => String.fromCharCode(Number(n)));
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** Tiny markdown-to-HTML for the subset the comment uses (headings, tables, lists, code, footer). */
export function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (!line.trim() || line.startsWith('<!--')) continue;
    if ((m = /^<sub>(.*)<\/sub>$/.exec(line))) { out.push(`<p class="footer">${inline(m[1])}</p>`); continue; }
    if ((m = /^(#{1,6}) (.*)$/.exec(line))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (line.startsWith('```')) {
      const buf = [];
      while (++i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? ' class="r"' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      const th = head.map((h, k) => `<th${aligns[k]}>${inline(h)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${r.map((c, k) => `<td${aligns[k]}>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      i--;
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('\n');
}

const CSS = `
:root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--head:#f6f8fa;--code:#818b981f;--link:#0969da;--page:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#f0f6fc;--muted:#9198a1;--border:#3d444d;--head:#151b23;--code:#656c7633;--link:#4493f8;--page:#010409}}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px;background:var(--page);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
.comment{max-width:860px;margin:0 auto;border:1px solid var(--border);border-radius:6px;background:var(--bg);overflow:hidden}
.header{display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--head);border-bottom:1px solid var(--border);color:var(--muted)}
.avatar{width:24px;height:24px;border-radius:50%;background:#6e7781;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}
.header strong{color:var(--fg)}.bot{border:1px solid var(--border);border-radius:2em;padding:0 7px;font-size:12px}
.body{padding:16px;overflow-x:auto}
h3{font-size:20px;margin:0 0 12px}h4{font-size:16px;margin:24px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--border)}
p{margin:0 0 12px}ul{margin:0 0 12px;padding-left:2em}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
code{background:var(--code);border-radius:6px;padding:.2em .4em;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
table{border-collapse:collapse;margin:0 0 16px;display:block;overflow:auto}
th,td{border:1px solid var(--border);padding:6px 13px;text-align:left}th{font-weight:600;background:var(--head)}
tr:nth-child(2n) td{background:var(--head)}.r{text-align:right}
.footer{color:var(--muted);font-size:12px;margin:16px 0 0}
pre{background:var(--head);padding:12px;border-radius:6px;overflow:auto}
`;

const COMMENT_HEADER = '<span class="avatar">GA</span><strong>github-actions</strong><span class="bot">bot</span><span>commented on this pull request</span>';
const REPORT_HEADER = '<span class="avatar">PG</span><strong>Promotion Gatekeeper</strong><span>cross-environment report</span>';

export function htmlPage(md, { title = 'Promotion Gatekeeper', header = COMMENT_HEADER, wide = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${CSS}${wide ? '.comment{max-width:1200px}' : ''}</style></head>
<body><div class="comment"><div class="header">${header}</div>
<div class="body">
${markdownToHtml(md)}
</div></div></body></html>
`;
}

export function renderPreview(mdPath, htmlPath, title = 'Promotion Gatekeeper: sample comment') {
  writeFileSync(htmlPath, htmlPage(readFileSync(mdPath, 'utf8'), { title }));
}

const PRESENCE = { yes: '✅', equiv: '♻️', no: '—' };

/** Markdown for the per-change, per-environment ledger. */
export function ledgerMarkdown(result, { slug, serverUrl = 'https://github.com' } = {}) {
  const rows = result.ledger || [];
  const envs = result.envs;
  const out = ['### Cross-environment ledger', ''];
  out.push(`Environments: ${envs.map((e) => `\`${e}\``).join(' → ')}. ✅ present · ♻️ patch-equivalent twin present · — absent · ▶ included in this PR. Changes present everywhere are omitted.`, '');
  if (!rows.length) { out.push('Every change is present in every environment.', ''); return out.join('\n'); }
  out.push(`| | Change | Commit | ${envs.join(' | ')} | CI | Cherry-pick check |`);
  out.push(`|---|---|---|${envs.map(() => '---').join('|')}|---|---|`);
  for (const r of rows) {
    const cells = envs.map((e) => PRESENCE[r.presence[e]]).join(' | ');
    let conflict = '';
    if (r.conflict) conflict = r.conflict.conflict ? `⚠️ conflicts on ${r.conflict.env}: ${r.conflict.files.map((f) => `\`${esc(f, 60)}\``).join(', ')}` : `clean on ${r.conflict.env}`;
    out.push(`| ${r.included ? '▶' : ''} | ${esc(r.subject, 70)} | ${commitLink(r.sha, slug, serverUrl)} | ${cells} | ${ciLabel(r.ci)} | ${conflict} |`);
  }
  out.push('');
  if (result.ledgerTruncated) out.push(`Showing the newest changes; ${result.ledgerTruncated} older ones omitted.`, '');
  return out.join('\n');
}
