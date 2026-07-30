/**
 * Ownership ledger — tracks which OCI resources were created by this MCP.
 * Persisted to disk (path configurable via OCI_MCP_OWNERSHIP_LEDGER).
 *
 * Used by guards.js to differentiate "MCP-owned" from "third-party" resources.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteJsonSync } from "@gustapaes/mcp-runtime";
import { config } from "../config.js";

const FILE = config.ownershipLedgerPath;

function ensureParentDirectory() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
}

function read() {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch (error) {
    throw new Error(`Ownership ledger is not valid JSON: ${error.message}`);
  }
}

function write(data) {
  ensureParentDirectory();
  atomicWriteJsonSync(FILE, data);
}

export function record({ ocid, type, name, compartment, tags = {}, extra = {} }) {
  if (!ocid) return;
  const data = read();
  data[ocid] = {
    type,
    name,
    compartment,
    tags,
    createdBy: "oci-extras-mcp",
    createdAt: new Date().toISOString(),
    ...extra,
  };
  write(data);
}

export function get(ocid) {
  if (!ocid) return null;
  const data = read();
  return data[ocid] ?? null;
}

export function isOwned(ocid) {
  return get(ocid) !== null;
}

export function remove(ocid) {
  const data = read();
  delete data[ocid];
  write(data);
}

export function list({ type } = {}) {
  const data = read();
  return Object.entries(data)
    .filter(([, v]) => !type || v.type === type)
    .map(([ocid, v]) => ({ ocid, ...v }));
}
