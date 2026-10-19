import { DELIVERY_CONFIG } from './config.js';

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (item) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[item]);
export function evidenceAttachmentName(entry, timeZone = DELIVERY_CONFIG.timeZone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(entry.provenance.finishedAt));
  const value = (type) => parts.find((part) => part.type === type).value;
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  const title = (entry.title || entry.scenario).normalize('NFC').replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[. ]+$/gu, '') || 'Evidence';
  let bounded = '';
  for (const character of title) { if (bounded.length + character.length > 75) break; bounded += character; }
  return `${bounded.trimEnd()} - ${date}${entry.extension}`;
}
export function renderDiscussion(manifest, level, attachments) {
  const pt = DELIVERY_CONFIG.locale === 'pt-BR', e = escapeHtml;
  const title = level === 'verified' ? (pt ? 'Entrega validada' : 'Validated delivery') : (pt ? 'Entrega parcial — pendências' : 'Partial delivery — pending checks');
  const result = { passed: pt ? 'Aprovado' : 'Passed', failed: pt ? 'Falhou' : 'Failed', blocked: pt ? 'Pendente' : 'Blocked' };
  const cases = manifest.testCases ?? [];
  const reports = manifest.reports.map((report) => `${e(report.label ?? report.format)}: ${report.counts.passed}/${report.counts.total}${report.counts.failed ? ` (${report.counts.failed} ${pt ? 'falhas' : 'failed'})` : ''}${report.counts.skipped ? ` (${report.counts.skipped} ${pt ? 'ignorados' : 'skipped'})` : ''}`).join(' · ');
  const links = (entries) => entries.map((entry) => `<a href="${e(entry.url)}">${e(entry.name)}</a>`).join('<br>');
  let html = `<h3>${title}</h3>${manifest.summary ? `<p>${e(manifest.summary)}</p>` : ''}`;
  if (reports) html += `<p><b>${pt ? 'Testes' : 'Tests'}:</b> ${reports}</p>`;
  if (cases.length) html += `<table><tr><th>${pt ? 'Caso testado' : 'Test case'}</th><th>${pt ? 'Resultado' : 'Result'}</th><th>${pt ? 'Prova' : 'Evidence'}</th></tr>`
    + cases.map((item) => `<tr><td>${e(item.title)}</td><td>${result[item.result]}</td><td>${links(attachments.filter((entry) => item.evidence_scenarios.includes(entry.scenario)))}</td></tr>`).join('') + '</table>';
  const unlisted = attachments.filter((entry) => !cases.some((item) => item.evidence_scenarios.includes(entry.scenario)));
  if (unlisted.length) html += `<p>${links(unlisted)}</p>`;
  for (const image of attachments.filter((entry) => entry.kind === 'image').slice(0, 3)) {
    html += `<p>${e(image.title || image.scenario)}<br><a href="${e(image.url)}"><img src="${e(image.url)}" alt="${e(image.title || image.scenario)}" width=480></a></p>`;
  }
  if (manifest.pending.length) html += `<p><b>${pt ? 'Pendências' : 'Pending'}:</b></p><ul>${manifest.pending.map((item) => `<li>${e(item.replace(/^Declared limitation: /, ''))}</li>`).join('')}</ul>`;
  if (manifest.pullRequestUrl) html += `<p><a href="${e(manifest.pullRequestUrl)}">PR ${manifest.identity.pullRequestId}</a> · ${manifest.sourceSha.slice(0, 12)}</p>`;
  html += `<p>${pt ? 'Relatórios conferidos; origem declarada, execução fora deste servidor.' : 'Reports checked; provenance declared, execution outside this server.'}</p>`;
  if (Buffer.byteLength(html) > 60_000) throw new Error('Discussion evidence exceeds the 60 KiB limit.');
  return html;
}
