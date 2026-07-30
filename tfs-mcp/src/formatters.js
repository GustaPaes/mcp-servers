/**
 * formatters.js — Normalização e formatação de dados do TFS.
 * Funções puras, sem side effects, sem network calls.
 */
import {
  TFS_URL,
  TFS_COLLECTION,
  TFS_PROJECT,
  getConfiguredWorkItemProfile,
} from "./config.js";

// ─── Text helpers ──────────────────────────────────────────────────────────

export function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeWiql(value) {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Decodifica entidades HTML basicas. Usado para campos rich-text do TFS
 * (System.Description, campos ricos configurados e AcceptanceCriteria)
 * quando o cliente MCP serializa a string como HTML-encoded para evitar
 * interpretacao de markup no transporte.
 *
 * Suporta: &lt; &gt; &amp; &quot; &#39; &apos; &#NN; &#xHH;
 */
export function decodeHtmlEntities(value) {
  if (value == null) return value;
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * Heuristica: detecta se a string parece HTML-encoded (chegou escapado pelo
 * cliente MCP) em vez de HTML real. Se contem &lt;tag e nao contem nenhuma
 * tag aberta de verdade, decodifica.
 */
export function autoDecodeRichText(value) {
  if (typeof value !== "string" || !value) return value;
  const hasEncodedTag = /&lt;\/?[a-zA-Z][\s\S]*?&gt;/.test(value);
  const hasRealTag = /<\/?[a-zA-Z][\s\S]*?>/.test(value);
  if (hasEncodedTag && !hasRealTag) return decodeHtmlEntities(value);
  return value;
}

export function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

export function normalizeState(value) {
  return String(value ?? "").trim();
}

// ─── ID normalization ──────────────────────────────────────────────────────

export function normalizeWorkItemId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Work item id is required");
  const direct = Number(raw);
  if (Number.isInteger(direct)) return direct;
  const match =
    raw.match(/(?:edit\/|id=|\/workitems\/)(\d+)/i) ?? raw.match(/(\d+)/);
  if (!match) throw new Error(`Could not parse work item id from '${raw}'`);
  return Number(match[1]);
}

export function normalizePullRequestRef(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { id: value, repo: null, projectId: null };
  }

  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Pull request id is required");

  const direct = Number(raw);
  if (Number.isInteger(direct)) return { id: direct, repo: null, projectId: null };

  const urlMatch =
    raw.match(/_git\/([^/?#]+)\/pullrequest\/(\d+)/i) ??
    raw.match(/git\/repositories\/([^/?#]+)\/pullrequests\/(\d+)/i);
  if (urlMatch) {
    return { repo: decodeURIComponent(urlMatch[1]), id: Number(urlMatch[2]), projectId: null };
  }

  const artifactMatch = raw.match(
    /PullRequestId\/([^/]+)%2[fF]([^/]+)%2[fF](\d+)/i
  );
  if (artifactMatch) {
    return {
      projectId: decodeURIComponent(artifactMatch[1]),
      repo: decodeURIComponent(artifactMatch[2]),
      id: Number(artifactMatch[3]),
    };
  }

  const genericMatch = raw.match(/(\d+)/);
  if (genericMatch) return { id: Number(genericMatch[1]), repo: null, projectId: null };

  throw new Error(`Could not parse pull request id from '${raw}'`);
}

export function resolveRepository(preferredRepo, parsedRef, defaultRepo) {
  return preferredRepo ?? parsedRef?.repo ?? defaultRepo;
}

// ─── Domain formatters ─────────────────────────────────────────────────────

export function getWorkItemRichTextContent(workItem) {
  const fields = workItem?.fields ?? workItem ?? {};
  const workItemType = fields["System.WorkItemType"] ?? "";
  const profile = getConfiguredWorkItemProfile(workItemType);
  const businessField = profile.businessField ?? "System.Description";
  const technicalField =
    profile.technicalField ?? "Microsoft.VSTS.Common.AcceptanceCriteria";

  return {
    businessField,
    technicalField,
    description: fields[businessField] ?? fields["System.Description"] ?? "",
    acceptanceCriteria:
      fields[technicalField] ??
      fields["Microsoft.VSTS.Common.AcceptanceCriteria"] ??
      "",
  };
}

export function formatWorkItem(wi) {
  const f = wi.fields || {};
  const content = getWorkItemRichTextContent(wi);
  const rawBusinessDefinition = content.description;
  const rawTechnicalDefinition = content.acceptanceCriteria;
  const desc = stripHtml(rawBusinessDefinition);
  const ac = stripHtml(rawTechnicalDefinition);
  return {
    id: wi.id,
    url:
      wi._links?.html?.href ??
      `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_workitems/edit/${wi.id}`,
    type: f["System.WorkItemType"] ?? "",
    state: f["System.State"] ?? "",
    title: f["System.Title"] ?? "",
    assignedTo: f["System.AssignedTo"]?.displayName ?? "Unassigned",
    iteration: f["System.IterationPath"] ?? "",
    area: f["System.AreaPath"] ?? "",
    storyPoints: f["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null,
    priority: f["Microsoft.VSTS.Common.Priority"] ?? null,
    tags: f["System.Tags"] ?? "",
    description: desc.length > 800 ? desc.slice(0, 800) + "…" : desc,
    acceptanceCriteria: ac.length > 1200 ? ac.slice(0, 1200) + "…" : ac,
    businessDefinitionField: content.businessField,
    technicalDefinitionField: content.technicalField,
    parent:
      wi.relations
        ?.find((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse")
        ?.url?.match(/\/(\d+)$/)?.[1] ?? null,
    children:
      wi.relations
        ?.filter((r) => r.rel === "System.LinkTypes.Hierarchy-Forward")
        .map((r) => r.url?.match(/\/(\d+)$/)?.[1])
        .filter(Boolean) ?? [],
  };
}

export function formatPR(pr) {
  const votes = { approved: 0, waiting: 0, rejected: 0 };
  for (const r of pr.reviewers ?? []) {
    if (r.vote > 0) votes.approved++;
    else if (r.vote < 0) votes.rejected++;
    else votes.waiting++;
  }
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: pr.status,
    repository: pr.repository?.name ?? pr.repository?.id ?? null,
    isDraft: pr.isDraft ?? false,
    author: pr.createdBy?.displayName ?? "",
    createdDate: pr.creationDate,
    sourceBranch: pr.sourceRefName?.replace("refs/heads/", "") ?? "",
    targetBranch: pr.targetRefName?.replace("refs/heads/", "") ?? "",
    reviewers: (pr.reviewers ?? []).map((r) => ({ name: r.displayName, vote: r.vote })),
    votes,
    description: (pr.description ?? "").slice(0, 600),
    mergeStatus: pr.mergeStatus,
    url: pr._links?.web?.href ?? "",
  };
}
