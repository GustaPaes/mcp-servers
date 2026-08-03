/**
 * safety/selectors.ts — selector and URL guardrails.
 *
 * In strict mode, refuse navigation/interaction with privileged URLs and
 * selectors that obviously target browser-internal pages.
 */
import { config } from "../config.js";
import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "devtools://",
];

const dnsCache = new Map<string, { expiresAt: number; addresses: string[] }>();

export function isHostExplicitlyAllowed(hostname: string, patterns: readonly string[] = config.allowedHosts): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return patterns.some((entry) =>
    entry.startsWith("*.")
      ? host.endsWith(entry.slice(1)) && host !== entry.slice(2)
      : host === entry,
  );
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    const mapped = /(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
    if (mapped) return isPrivateAddress(mapped);
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:");
  }
  return true;
}

export function shouldBlockResolvedAddress(
  hostname: string,
  address: string,
  patterns: readonly string[] = config.allowedHosts,
): boolean {
  return config.blockPrivateNetworks && isPrivateAddress(address) && !isHostExplicitlyAllowed(hostname, patterns);
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) return [hostname];
  const now = Date.now();
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > now) return cached.addresses;
  const result = await lookup(hostname, { all: true, verbatim: true });
  const addresses = [...new Set(result.map((item) => item.address))];
  if (addresses.length === 0) throw new Error(`DNS returned no addresses for ${hostname}`);
  dnsCache.set(hostname, { addresses, expiresAt: now + config.dnsCacheTtlMs });
  return addresses;
}

export async function assertUrlAllowed(url: string): Promise<void> {
  if (!config.strict) return;
  const lower = url.trim().toLowerCase();
  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lower.startsWith(prefix)) {
      throw new Error(`URL blocked by strict mode: ${prefix} scheme not allowed`);
    }
  }
  if (lower.startsWith("file://")) {
    throw new Error("file:// URLs are blocked by strict mode");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL must be absolute and valid");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error(`URL protocol is not allowed: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) throw new Error("credentials embedded in URLs are not allowed");
  const explicitlyAllowed = isHostExplicitlyAllowed(parsed.hostname);
  if (config.allowedHosts.length > 0 && !explicitlyAllowed) {
    throw new Error(`host ${parsed.hostname} is outside PWMCP_ALLOWED_HOSTS`);
  }
  if (config.blockPrivateNetworks) {
    const addresses = await resolveAddresses(parsed.hostname);
    const blocked = addresses.find((address) => shouldBlockResolvedAddress(parsed.hostname, address));
    if (blocked) throw new Error(`host ${parsed.hostname} resolves to blocked address ${blocked}`);
  }
}

export function assertSelectorAllowed(selector: string): void {
  if (!config.strict) return;
  // Playwright supports text=, css=, xpath=, role=, etc. The only worry here
  // is users embedding inline scripts via a URL-like selector — bail if it
  // smells like a privileged scheme.
  const lower = selector.toLowerCase();
  for (const prefix of BLOCKED_URL_PREFIXES) {
    if (lower.includes(prefix)) {
      throw new Error(`Selector blocked by strict mode: contains ${prefix}`);
    }
  }
}
