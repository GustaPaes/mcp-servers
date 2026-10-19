import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { resolveInsideAny } from "@gustapaes/mcp-runtime";
import { DELIVERY_CONFIG, buildProjectUrl } from "./config.js";
import { parseTestEvidence } from "./test-evidence.js";
import { assertTrustedTfsUrl, canonicalAttachmentUrl } from "./tfs-client.js";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const hashObject = (value) => hash(JSON.stringify(canonical(value)));
const secretPath = (value) => String(value).split(/[\\/]/).some((part) => {
  const name = part.replace(/^[\s'"`]+|[\s'"`]+$/g, '');
  return /^\.env(?:$|\.)|^\.(?:git|ssh)$|^id_(?:rsa|ed25519)|(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?|sessions?)(?:$|[._-])|\.(?:pem|key|pfx|p12|kdbx)$|\.private\./i.test(name);
});
export async function readEvidenceFile(file, maxBytes, roots = DELIVERY_CONFIG.roots) {
  if (secretPath(file)) throw new Error("Secret files cannot be used as evidence.");
  const physical = resolveInsideAny(roots, file);
  if (secretPath(physical)) throw new Error("Secret files cannot be used as evidence.");
  const handle = await fs.open(physical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("Evidence size/type outside configured limits.");
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== stat.size) throw new Error("Evidence changed during reading.");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
export function mediaType(bytes, file, kind) {
  const ext = path.extname(file).toLowerCase();
  const formats = [
    ['.png', 'image/png', 'image', () => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
    ['.jpg', 'image/jpeg', 'image', () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255],
    ['.jpeg', 'image/jpeg', 'image', () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255],
    ['.webp', 'image/webp', 'image', () => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'],
    ['.mp4', 'video/mp4', 'video', () => bytes.toString('ascii', 4, 8) === 'ftyp'],
    ['.webm', 'video/webm', 'video', () => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))],
  ];
  const match = formats.find(([extension, , type, check]) => extension === ext && type === kind && check());
  if (!match) throw new Error("Media extension, signature and kind must agree.");
  return { mime: match[1], extension: match[0] };
}
export async function inspectEvidence(input, allowedCommits = [input.source_sha]) {
  const reports = [], media = [], buffers = [];
  let totalBytes = 0;
  for (const [group, entries, maxBytes] of [
    ['report', input.reports, DELIVERY_CONFIG.maxReportBytes], ['media', input.media, DELIVERY_CONFIG.maxMediaBytes],
  ]) {
    for (const entry of entries) {
      const start = Date.parse(entry.provenance.started_at), finish = Date.parse(entry.provenance.finished_at);
      if (finish < start || finish > Date.now() + 60_000) throw new Error("Invalid evidence provenance interval.");
      if (!allowedCommits.includes(entry.provenance.commit)) throw new Error("Evidence provenance does not match the requested source or its current observed pipeline merge commit.");
      const bytes = await readEvidenceFile(entry.path, maxBytes);
      totalBytes += bytes.length;
      if (totalBytes > DELIVERY_CONFIG.maxTotalBytes) throw new Error("Total evidence quota exceeded.");
      if (hash(bytes) !== entry.sha256) throw new Error("Evidence hash changed or is incorrect.");
      const common = { sha256: entry.sha256, bytes: bytes.length, provenance: {
        commit: entry.provenance.commit, executor: entry.provenance.executor,
        commandSha256: hash(entry.provenance.command), startedAt: entry.provenance.started_at, finishedAt: entry.provenance.finished_at,
      } };
      if (group === 'report') reports.push({ ...common, ...(entry.label ? { label: entry.label } : {}), format: entry.format, counts: parseTestEvidence(bytes, entry.format) });
      else {
        media.push({ ...common, scenario: entry.scenario, kind: entry.kind, ...mediaType(bytes, entry.path, entry.kind) });
        buffers.push(bytes);
      }
    }
  }
  const keys = media.map((item) => `${item.scenario}:${item.kind}:${item.sha256}`);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate media entries.");
  return { reports, media, buffers, totalBytes };
}

export function sectionMarker(key) { return `tfs-mcp-delivery:${key}`; }
const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const decodeAttribute = (value) => value.replace(/&(?:amp|quot|apos|#(\d+)|#x([a-f\d]+));/gi, (entity, decimal, hex) => {
  if (decimal || hex) {
    const code = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }
  return { '&amp;': '&', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()] ?? entity;
});
function mapOutsideLiterals(text, transform, literal = (value) => value) {
  const tags = /<\/?(pre|code)\b[^>]*>/gi, stack = [];
  let cursor = 0, protectedStart = 0, output = '';
  for (const match of text.matchAll(tags)) {
    const name = match[1].toLowerCase(), closing = match[0].startsWith('</');
    if (!closing) {
      if (!stack.length) { output += transform(text.slice(cursor, match.index)); protectedStart = match.index; }
      stack.push(name);
    } else if (stack.at(-1) === name) {
      stack.pop();
      if (!stack.length) { cursor = match.index + match[0].length; output += literal(text.slice(protectedStart, cursor)); }
    }
  }
  return output + (stack.length ? literal(text.slice(protectedStart)) : transform(text.slice(cursor)));
}
function markerHref(key, role, { workItemId }) {
  if (!Number.isSafeInteger(workItemId) || workItemId < 1) throw new Error('Work item identity required for HTML evidence markers.');
  return `${buildProjectUrl(`/_workitems/edit/${workItemId}`)}#${sectionMarker(key)}:${role}`;
}
function canonicalMarkerHref(value, key, role, context) {
  const url = assertTrustedTfsUrl(decodeAttribute(value));
  const expected = new URL(markerHref(key, role, context));
  const paths = [expected.pathname];
  if (/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(context.projectId ?? '')) {
    const parts = expected.pathname.split('/');
    parts[parts.length - 4] = context.projectId;
    paths.push(parts.join('/'));
  }
  if (url.search || !paths.some((entry) => entry.toLowerCase() === url.pathname.toLowerCase())
    || decodeURIComponent(url.hash.slice(1)) !== `${sectionMarker(key)}:${role}`) {
    throw new Error('Managed section marker is outside the reviewed work item scope.');
  }
  return expected.toString();
}
function sectionRange(text, key, context = {}) {
  const marker = sectionMarker(key), begin = `<!-- ${marker}:begin -->`, end = `<!-- ${marker}:end -->`;
  const start = text.indexOf(begin), finish = text.indexOf(end);
  const comments = start >= 0 || finish >= 0;
  if ((start < 0) !== (finish < 0) || (comments && (finish < start || text.indexOf(begin, start + 1) >= 0 || text.indexOf(end, finish + 1) >= 0))) {
    throw new Error('Managed section is ambiguous; human reconciliation required.');
  }
  const anchors = [];
  if (context.workItemId) {
    const visible = mapOutsideLiterals(text, (value) => value, (value) => ' '.repeat(value.length));
    for (const match of visible.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/a\s*>/gi)) {
      const href = decodeAttribute(match[2]);
      let fragment;
      try { fragment = decodeURIComponent(new URL(href).hash.slice(1)); } catch { continue; }
      if (!fragment.startsWith(`${marker}:`)) continue;
      const role = fragment.slice(marker.length + 1);
      if (!['begin', 'end'].includes(role)) throw new Error('Managed section marker is ambiguous.');
      canonicalMarkerHref(match[2], key, role, context);
      anchors.push({ role, start: match.index, end: match.index + match[0].length });
    }
  }
  if (anchors.length) {
    if (comments || anchors.length !== 2 || anchors[0].role !== 'begin' || anchors[1].role !== 'end') throw new Error('Managed section is ambiguous; human reconciliation required.');
    const heading = /<h3\b[^>]*>[ \t\r\n]*$/i.exec(text.slice(0, anchors[0].start));
    const headingEnd = /^[ \t\r\n]*<\/h3\s*>/i.exec(text.slice(anchors[0].end));
    const footer = /<p\b[^>]*>[ \t\r\n]*$/i.exec(text.slice(0, anchors[1].start));
    const footerEnd = /^[ \t\r\n]*<\/p\s*>/i.exec(text.slice(anchors[1].end));
    if (!heading || !headingEnd || !footer || !footerEnd || heading.index >= footer.index) throw new Error('Managed section HTML boundaries are ambiguous.');
    return { start: heading.index, end: anchors[1].end + footerEnd[0].length, html: true };
  }
  return comments ? { start, end: finish + end.length, html: false } : null;
}
export function normalizeManagedHtml(text, key, context) {
  const range = sectionRange(text, key, context);
  if (!range?.html) return text;
  const managed = mapOutsideLiterals(text.slice(range.start, range.end), (value) => value
    .replace(/[ \t\r\n]+(?=<\/(?:p|h3|td|th)\s*>)/gi, '')
    .replace(/(\bhref\s*=\s*)(["'])(.*?)\2/gi, (original, prefix, quote, href) => {
      const decoded = decodeAttribute(href);
      try {
        const url = new URL(decoded), fragment = decodeURIComponent(url.hash.slice(1));
        if (fragment === `${sectionMarker(key)}:begin` || fragment === `${sectionMarker(key)}:end`) {
          return `${prefix}${quote}${escapeAttribute(canonicalMarkerHref(href, key, fragment.split(':').at(-1), context))}${quote}`;
        }
        return `${prefix}${quote}${escapeAttribute(canonicalAttachmentUrl(decoded, context))}${quote}`;
      } catch { return original; }
    }));
  return text.slice(0, range.start) + managed + text.slice(range.end);
}
export const managedHtmlHash = (text, key, context) => hash(normalizeManagedHtml(text, key, context));
export async function guardSectionReplay(text, key, side, state, save, context = {}) {
  const previous = state.sectionWrites?.[side];
  if (!previous) return;
  const currentHash = previous.normalization ? managedHtmlHash(text, key, context) : hash(text);
  const hasMarkers = Boolean(sectionRange(text, key, context));
  if (previous.ambiguous && currentHash !== previous.afterHash) {
    throw new Error("Managed section is ambiguous; restore the reviewed remote section before retrying publication.");
  }
  if (!hasMarkers && currentHash !== previous.beforeHash) {
    previous.ambiguous = true;
    await save();
    throw new Error("Managed section markers were lost; manual remote reconciliation required before retrying.");
  }
  if (previous.ambiguous) { previous.ambiguous = false; await save(); }
}
export async function beginSectionWrite(before, after, side, state, save, context = {}) {
  state.sectionWrites ??= {};
  state.sectionWrites[side] = context.workItemId
    ? { beforeHash: managedHtmlHash(before, state.key, context), afterHash: managedHtmlHash(after, state.key, context), ambiguous: false, normalization: 'work-item-html-v1' }
    : { beforeHash: hash(before), afterHash: hash(after), ambiguous: false };
  await save();
}
export function replaceManagedSection(text = '', key, body, context = {}) {
  const marker = sectionMarker(key);
  const begin = `<!-- ${marker}:begin -->`, end = `<!-- ${marker}:end -->`;
  const range = sectionRange(text, key, context);
  let section = `${begin}\n${body}\n${end}`;
  if (context.workItemId) {
    if (!/^<h3>[^<]*<\/h3>/.test(body) || !/<p>[^<]*<\/p>$/.test(body)) throw new Error('HTML evidence requires its generated heading and footer.');
    section = body.replace(/^<h3>([^<]*)<\/h3>/, `<h3><a href="${escapeAttribute(markerHref(key, 'begin', context))}">$1</a></h3>`)
      .replace(/<p>([^<]*)<\/p>$/, `<p><a href="${escapeAttribute(markerHref(key, 'end', context))}">$1</a></p>`);
  }
  return !range ? `${text}${text ? '\n\n' : ''}${section}` : text.slice(0, range.start) + section + text.slice(range.end);
}
export function preserveDeliverySections(previous, replacement) {
  const sections = String(previous ?? '').match(/<!-- tfs-mcp-delivery:([a-f0-9]{64}):begin -->[\s\S]*?<!-- tfs-mcp-delivery:\1:end -->/g) ?? [];
  return [replacement, ...sections].join('\n\n');
}
