import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { resolveInsideAny } from "@gustapaes/mcp-runtime";
import { DELIVERY_CONFIG } from "./config.js";
import { parseTestEvidence } from "./test-evidence.js";

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
export async function guardSectionReplay(text, key, side, state, save) {
  const previous = state.sectionWrites?.[side];
  if (!previous) return;
  const currentHash = hash(text);
  const marker = sectionMarker(key);
  const hasMarkers = text.includes(`<!-- ${marker}:begin -->`) && text.includes(`<!-- ${marker}:end -->`);
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
export async function beginSectionWrite(before, after, side, state, save) {
  state.sectionWrites ??= {};
  state.sectionWrites[side] = { beforeHash: hash(before), afterHash: hash(after), ambiguous: false };
  await save();
}
export function replaceManagedSection(text = '', key, body) {
  const marker = sectionMarker(key);
  const begin = `<!-- ${marker}:begin -->`, end = `<!-- ${marker}:end -->`;
  const start = text.indexOf(begin), finish = text.indexOf(end);
  if ((start < 0) !== (finish < 0) || (start >= 0 && (finish < start || text.indexOf(begin, start + 1) >= 0 || text.indexOf(end, finish + 1) >= 0))) {
    throw new Error("Managed section is ambiguous; human reconciliation required.");
  }
  const section = `${begin}\n${body}\n${end}`;
  return start < 0 ? `${text}${text ? '\n\n' : ''}${section}` : text.slice(0, start) + section + text.slice(finish + end.length);
}
export function preserveDeliverySections(previous, replacement) {
  const sections = String(previous ?? '').match(/<!-- tfs-mcp-delivery:([a-f0-9]{64}):begin -->[\s\S]*?<!-- tfs-mcp-delivery:\1:end -->/g) ?? [];
  return [replacement, ...sections].join('\n\n');
}
