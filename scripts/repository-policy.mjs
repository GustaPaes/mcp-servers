const RESERVED_EMAIL_DOMAINS = new Set(["example.com", "acme.example"]);

function hasLocalAbsolutePath(text) {
  const windowsAbsolute = /(?:^|[\s"'`(=])(?:[A-Za-z]:[\\/])(?!(?:[<>][^\\/]*[<>]|\$\{))/m;
  const personalPosix = /(?:^|[\s"'`(=])\/(?:Users|home)\/(?!<|\$\{)[A-Za-z0-9._-]+\//m;
  return windowsAbsolute.test(text) || personalPosix.test(text);
}

function containsForbiddenTerm(text, forbiddenTerms) {
  return forbiddenTerms.some((term) => {
    const candidate = String(term ?? "").trim();
    if (candidate.length < 3) return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
  });
}

function hasPrivateEndpoint(text) {
  const urls = text.match(/https?:\/\/[^\s"'`<>]+/gi) ?? [];
  return urls.some((candidate) => {
    let url;
    try {
      url = new URL(candidate);
    } catch {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (url.username || url.password) return true;
    if (/(?:^|\.)(?:internal|corp|lan|local)$/.test(host)) return true;
    if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return true;
    return false;
  });
}

export function inspectPublishableText(file, text, { forbiddenTerms = [] } = {}) {
  const errors = [];
  const normalized = file.replaceAll("\\", "/");
  const isPolicySource = normalized.startsWith("scripts/repository-");

  if (!isPolicySource && hasLocalAbsolutePath(text)) {
    errors.push(`environment-specific absolute path found: ${normalized}`);
  }
  if (!isPolicySource && containsForbiddenTerm(text, forbiddenTerms)) {
    errors.push(`organization-specific marker found: ${normalized}`);
  }
  if (!isPolicySource && hasPrivateEndpoint(text)) {
    errors.push(`private or credentialed URL found: ${normalized}`);
  }

  const emails = text.match(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g) ?? [];
  if (emails.some((email) => {
    const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    return !RESERVED_EMAIL_DOMAINS.has(domain);
  })) {
    errors.push(`non-example email found: ${normalized}`);
  }

  const workItemReferences = [...text.matchAll(/\b(?:US|PBI|work item)\s*#?(\d{5,})\b/gi)];
  if (workItemReferences.some((reference) => reference[1] !== "12345")) {
    errors.push(`real-looking work item reference found: ${normalized}`);
  }
  if (/['"]requestedBy['"]\s*:\s*['"]user:(?!operator|example)/i.test(text)) {
    errors.push(`non-neutral requestedBy example found: ${normalized}`);
  }
  if (/(?:^|[\s"'`])(?:ocid1\.[a-z]+\.[a-z0-9-]+\.[a-z0-9-]*\.[a-z0-9]{20,}|EAA[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/m.test(text)) {
    errors.push(`credential-like identifier found: ${normalized}`);
  }
  if (/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/.test(text)) {
    errors.push(`JWT-like value found: ${normalized}`);
  }

  return errors;
}

export function isPrivatePublishablePath(file) {
  const normalized = file.replaceAll("\\", "/");
  return normalized.includes("/local-private/")
    || normalized.endsWith("/.env")
    || /\/(?:data|output)\/(?!\.gitkeep$)/.test(normalized);
}
