import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const configKeys = ['GRAFANA_URL', 'GRAFANA_TOKEN', 'GRAFANA_EXPORT_ROOT', 'GRAFANA_TIMEOUT_MS'];
export function loadConfig(env = process.env) {
  const timeoutMs = Number(env.GRAFANA_TIMEOUT_MS ?? 15000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('INVALID_GRAFANA_TIMEOUT_MS');
  const exportRoot = env.GRAFANA_EXPORT_ROOT ?? 'local-private/exports';
  if (!exportRoot.trim() || exportRoot.includes('\0')) throw new Error('INVALID_GRAFANA_EXPORT_ROOT');
  const token = env.GRAFANA_TOKEN || undefined;
  if (token && !/^[A-Za-z0-9_.=-]{1,8192}$/.test(token)) throw new Error('INVALID_GRAFANA_TOKEN');
  return { url: env.GRAFANA_URL || undefined, token, timeoutMs, exportRoot: path.resolve(serverRoot, exportRoot) };
}
