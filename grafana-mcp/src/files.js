import fs from 'node:fs/promises';
import path from 'node:path';
import { GrafanaError } from './client.js';

export async function readExport(root, file) {
  if (!/\.json$/i.test(file) || /(?:^|[\\/])\.|secret|token|credential|config|account/i.test(file)) throw new GrafanaError('EXPORT_FILE_NOT_ALLOWED');
  const canonicalRoot = await fs.realpath(root);
  const candidate = await fs.realpath(path.resolve(canonicalRoot, file));
  const relative = path.relative(canonicalRoot, candidate);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new GrafanaError('EXPORT_OUTSIDE_ROOT');
  if (!/\.json$/i.test(relative) || /(?:^|[\\/])\.|secret|token|credential|config|account/i.test(relative)) throw new GrafanaError('EXPORT_FILE_NOT_ALLOWED');
  const handle = await fs.open(candidate, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2_000_000) throw new GrafanaError('EXPORT_SIZE_LIMIT');
    const chunks = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > 2_000_000) throw new GrafanaError('EXPORT_SIZE_LIMIT');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new GrafanaError('INVALID_EXPORT_JSON'); }
  } finally { await handle.close(); }
}
