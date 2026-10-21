import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { requireRemoteConfig } from "./remote-config.js";

const cancellationContext = new AsyncLocalStorage();
export function withRemoteCancellation(signal, task) {
  return cancellationContext.run(signal, task);
}

// Deny non-global ranges, including IPv4-mapped IPv6 and cloud metadata targets.
export function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 192 && b === 2) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) !== 6) return false;
  const ip = address.toLowerCase();
  // Only global unicast 2000::/3; deny transition, documentation and special ranges.
  return (
    /^[23]/.test(ip) &&
    !/^(2001:(?:0:|db8:|[01][0-9a-f]:)|2002:|3fff:)/.test(ip)
  );
}

export function publicLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, verbatim: true }).then(
      (addresses) => {
        if (
          !addresses.length ||
          addresses.some((x) => !isPublicAddress(x.address))
        )
          return callback(
            new Error(
              "Remote API DNS must resolve exclusively to public addresses.",
            ),
          );
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      () => callback(new Error("Remote API DNS lookup failed.")),
    );
  };
}

async function authentication(config, target) {
  if (config.token) return { authorization: `Bearer ${config.token}` };
  if (config.cookie) return { cookie: config.cookie };
  try {
    const [root, file] = await Promise.all([
      fs.realpath(config.sessionRoot),
      fs.realpath(config.sessionFile),
    ]);
    const relative = path.relative(root, file);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      path.extname(file) !== ".json"
    )
      throw new Error();
    if ((await fs.stat(file)).size > 1048576) throw new Error();
    const state = JSON.parse(await fs.readFile(file, "utf8"));
    if (Object.keys(state).some((key) => key !== "cookies")) throw new Error();
    const cookies = state.cookies;
    if (!Array.isArray(cookies) || cookies.length > 200) throw new Error();
    const scoped = cookies.filter((c) => {
      const domain = String(c.domain || "")
        .replace(/^\./, "")
        .toLowerCase();
      const matches = c.domain?.startsWith(".")
        ? target.hostname === domain || target.hostname.endsWith(`.${domain}`)
        : target.hostname === domain;
      const cookiePath = c.path || "/";
      const pathMatches =
        target.pathname === cookiePath ||
        (target.pathname.startsWith(cookiePath) &&
          (cookiePath.endsWith("/") ||
            target.pathname[cookiePath.length] === "/"));
      return (
        matches &&
        pathMatches &&
        (c.expires === -1 || Number(c.expires) * 1000 > Date.now())
      );
    });
    if (
      !scoped.length ||
      scoped.some(
        (c) =>
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name) ||
          typeof c.value !== "string" ||
          /[\r\n;]/.test(c.value),
      )
    )
      throw new Error();
    const cookie = scoped.map((c) => `${c.name}=${c.value}`).join("; ");
    if (cookie.length > 32768) throw new Error();
    return { cookie };
  } catch {
    throw new Error(
      "Remote session file is unavailable, expired or outside CAREER_REMOTE_SESSION_ROOT. Renew the dedicated private cookie-only JSON file.",
    );
  }
}

export function createRemoteHttp(
  config,
  { request = https.request, resolve = dns.lookup } = {},
) {
  let queue = Promise.resolve();
  return async (route, { method = "GET", body, form = false } = {}) => {
    requireRemoteConfig(config);
    const signal = cancellationContext.getStore();
    const target = new URL(route, config.origin);
    if (
      !route.startsWith("/") ||
      route.startsWith("//") ||
      target.origin !== config.origin ||
      target.username ||
      target.password ||
      !config.allowedHosts.includes(target.hostname)
    )
      throw new Error("Remote request escaped the configured API origin.");
    const run = async () => {
      if (signal?.aborted)
        throw new Error("Remote request cancelled before transmission.");
      const headers = {
        accept: "application/json",
        ...(await authentication(config, target)),
      };
      let payload;
      if (body !== undefined) {
        const boundary = `career-${randomUUID()}`;
        payload = form
          ? Object.entries(body)
              .map(([name, value]) => {
                if (!/^[a-zA-Z]+$/.test(name) || typeof value !== "string")
                  throw new Error("Invalid remote form field.");
                return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
              })
              .join("") + `--${boundary}--\r\n`
          : JSON.stringify(body);
        if (Buffer.byteLength(payload) > 131072)
          throw new Error("Remote request body exceeds 128 KiB.");
        headers["content-type"] = form
          ? `multipart/form-data; boundary=${boundary}`
          : "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }
      return new Promise((resolveResult, reject) => {
        let settled = false;
        let timer;
        let cancel;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (cancel) signal?.removeEventListener("abort", cancel);
          error ? reject(error) : resolveResult(value);
        };
        const req = request(
          target,
          { method, headers, agent: false, lookup: publicLookup(resolve) },
          (response) => {
            const status = response.statusCode;
            if (status < 200 || status >= 300) {
              response.resume();
              const message =
                status === 401 || status === 403
                  ? "Remote authentication expired or access denied. Renew the private authentication source."
                  : status === 429
                    ? "Remote provider rate limit reached. Respect Retry-After and retry the read later; writes are never retried automatically."
                    : `Remote provider returned HTTP ${status}. Response details are withheld.`;
              finish(new Error(message));
              return;
            }
            const chunks = [];
            let bytes = 0;
            response.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > config.maxResponseBytes) {
                finish(
                  new Error(
                    "Remote response exceeds the configured byte limit.",
                  ),
                );
                response.destroy();
                req.destroy();
              } else chunks.push(chunk);
            });
            response.on("error", () =>
              finish(
                new Error(
                  "Remote response interrupted. Outcome may be unknown for writes.",
                ),
              ),
            );
            response.on("end", () => {
              if (settled) return;
              try {
                const raw = Buffer.concat(chunks).toString("utf8");
                finish(null, raw.trim() ? JSON.parse(raw) : null);
              } catch {
                finish(
                  new Error(
                    "Remote provider returned invalid JSON. Response details are withheld.",
                  ),
                );
              }
            });
          },
        );
        req.on("error", () =>
          finish(
            new Error(
              "Remote request failed or timed out. Outcome may be unknown for writes; reconcile before retrying.",
            ),
          ),
        );
        cancel = () => {
          finish(
            new Error(
              "Remote request cancelled. Outcome may be unknown for writes; reconcile before retrying.",
            ),
          );
          req.destroy();
        };
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) {
          cancel();
          return;
        }
        timer = setTimeout(() => {
          finish(
            new Error(
              "Remote request timed out. Outcome may be unknown for writes; reconcile before retrying.",
            ),
          );
          req.destroy();
        }, config.timeoutMs);
        if (payload !== undefined) req.write(payload);
        req.end();
      });
    };
    // One external request at a time per server/account; no implicit retries.
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };
}
