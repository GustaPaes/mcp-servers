import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, resolveInside } from "@gustapaes/mcp-runtime";
import { z } from "zod";
import { DELIVERY_CONFIG } from "./config.js";
import { validateTfsAttachmentReceipt } from "./tfs-client.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ownedAttachment = z.strictObject({ url: z.string().max(2048), name: z.string().max(100), sha256: digest,
  scenario: z.string().max(80), kind: z.enum(['image', 'video']), marker: z.string().max(200) });
const sectionWrite = z.strictObject({ beforeHash: digest, afterHash: digest, ambiguous: z.boolean(),
  normalization: z.literal('work-item-html-v1').optional() });
const ledger = z.strictObject({ schemaVersion: z.literal(1), key: digest,
  receipts: z.record(digest, z.discriminatedUnion('stage', [z.strictObject({ stage: z.literal('uploading') }),
    z.strictObject({ stage: z.literal('uploaded'), id: z.string().uuid(), url: z.string().max(2048), sha256: digest })])),
  managed: z.array(ownedAttachment).max(1000), pendingAttachments: z.array(ownedAttachment).max(20).optional(),
  ambiguousRelations: z.boolean().optional(),
  lastManifest: z.record(z.string(), z.unknown()).optional(),
  lastPublication: z.strictObject({ digest, sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    evidenceLevel: z.enum(['unverified', 'partial', 'verified']) }).optional(),
  sectionWrites: z.strictObject({ workItem: sectionWrite.optional(), pullRequest: sectionWrite.optional() }).optional(),
});
function validateLedger(state, key, projectId) {
  try {
    ledger.parse(state);
    if (state.key !== key || Object.keys(state.receipts).length > 1000) throw new Error();
    for (const receipt of Object.values(state.receipts)) {
      if (receipt.stage === 'uploaded' && validateTfsAttachmentReceipt(receipt, { projectId }).url !== receipt.url) throw new Error();
    }
    for (const entry of [...state.managed, ...(state.pendingAttachments ?? [])]) {
      const id = new URL(entry.url).pathname.split('/').at(-1);
      const receipt = state.receipts[entry.marker.split(':').at(-1)];
      if (validateTfsAttachmentReceipt({ id, url: entry.url }, { projectId }).url !== entry.url
        || !new RegExp(`^tfs-mcp-delivery:${key}:[a-f0-9]{64}$`).test(entry.marker)
        || !new RegExp(`^evidence-${entry.sha256}\\.(?:png|jpg|jpeg|webp|mp4|webm)$`).test(entry.name)
        || receipt?.stage !== 'uploaded' || receipt.url !== entry.url || receipt.sha256 !== entry.sha256) throw new Error();
    }
  } catch { throw new Error('Invalid delivery ledger; reconcile private state before publishing.'); }
}

export async function withDeliveryState(key, action, { projectId } = {}) {
  const root = DELIVERY_CONFIG.stateDirectory;
  await fs.mkdir(root, { recursive: true });
  const file = resolveInside(root, `${key}.json`), lock = resolveInside(root, `${key}.lock`);
  const entries = await fs.readdir(root);
  if (!entries.includes(`${key}.json`) && entries.filter((name) => name.endsWith('.json')).length >= DELIVERY_CONFIG.maxLedgers) {
    throw new Error("Delivery ledger quota reached; archive reviewed records before continuing.");
  }
  let lease;
  try { lease = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error("Delivery locked; reconcile a previous interrupted publisher before removing its local lease.");
    throw error;
  }
  try {
    let state = { schemaVersion: 1, key, receipts: {}, managed: [] };
    try {
      const stat = await fs.stat(file);
      if (stat.size > 2_097_152) throw new Error("Delivery ledger exceeds size limit.");
      state = JSON.parse(await fs.readFile(file, 'utf8'));
      validateLedger(state, key, projectId);
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid delivery ledger; reconcile private state before publishing.'); }
    const save = () => {
      if (Buffer.byteLength(JSON.stringify(state)) > 2_097_152) throw new Error("Delivery ledger quota reached; archive before continuing.");
      return atomicWriteJson(file, state);
    };
    const audit = async (event) => {
      const auditFile = resolveInside(root, 'delivery-audit.jsonl');
      const size = await fs.stat(auditFile).then((stat) => stat.size, (error) => { if (error.code === 'ENOENT') return 0; throw error; });
      if (size > 10_485_760) throw new Error("Delivery audit quota reached; archive before publishing.");
      await fs.appendFile(auditFile, `${JSON.stringify({ at: new Date().toISOString(), key, ...event })}\n`, { mode: 0o600 });
    };
    return await action({ state, save, audit });
  } finally {
    await lease.close();
    await fs.unlink(lock);
  }
}
