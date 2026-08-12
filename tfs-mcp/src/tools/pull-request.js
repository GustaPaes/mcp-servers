/**
 * tools/pull-request.js — PR tools: list, get, review, add comment, prepare PR review.
 */
import { z } from "zod";
import { tfsGet, tfsGetAbsoluteText, tfsPost, tfsPatch } from "../tfs-client.js";
import {
  buildProjectUrl,
  getConfiguredRepositories,
  getDefaultRepository,
  getRepositoryCandidates,
} from "../config.js";
import { formatPR, resolveRepository, normalizePullRequestRef } from "../formatters.js";
import { runPatternChecks, scoreReview } from "../rules.js";
import { getRequestContext } from "../request-context.js";
import { buildSpecialistReview } from "../specialists.js";
import {
  buildMutationPlan,
  detectHighImpact,
  executeGuardedMutation,
  normalizeMutationControls,
} from "../safety.js";
import {
  summarizeFileChanges,
  detectCriticalFileAreas,
} from "../analytics.js";
import { fetchWorkItemsBatch, extractPullRequestRefs } from "./work-item.js";
import {
  ensurePullRequestWorkItemLinks,
  normalizePRWorkItemIds,
} from "./pull-request-links.js";
import { loadPullRequestPipelines } from "./pull-request-builds.js";

// Convenience wrapper that falls back to configured default repo
function resolveRepo(preferredRepo) {
  return resolveRepository(preferredRepo, null, getDefaultRepository());
}

function candidateRepos(preferredRepo, parsedRepo) {
  if (preferredRepo?.trim()) return [preferredRepo.trim()];
  if (parsedRepo?.trim()) return [parsedRepo.trim()];
  return getRepositoryCandidates();
}

function sortPullRequestsDescending(items) {
  return [...items].sort(
    (a, b) =>
      new Date(b.createdDate ?? 0).getTime() - new Date(a.createdDate ?? 0).getTime()
  );
}

async function resolvePullRequestTarget(idOrRef, preferredRepo) {
  const parsedRef = normalizePullRequestRef(idOrRef);
  const repositories = candidateRepos(preferredRepo, parsedRef.repo);

  if (!repositories.length) {
    throw new Error("Nenhum repositório TFS configurado. Defina TFS_REPOS ou informe repo na chamada.");
  }

  const results = await Promise.allSettled(
    repositories.map(async (repository) => ({
      repository,
      pr: await tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}`),
    }))
  );

  const match = results.find((result) => result.status === "fulfilled" && result.value?.pr);
  if (match?.status === "fulfilled") {
    return {
      repository: match.value.repository,
      pr: match.value.pr,
      parsedRef,
    };
  }

  const firstFailure = results.find(
    (result) => result.status === "rejected" && result.reason?.status !== 404
  );
  if (firstFailure?.status === "rejected") throw firstFailure.reason;

  throw new Error(
    `PR ${parsedRef.id} não encontrado nos repositórios configurados: ${repositories.join(", ")}`
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function inferRepositoryFromPR(pr) {
  return pr?.repository?.name ?? pr?.repositoryName ?? getDefaultRepository();
}

function isTestFile(filePath = "") {
  return /(test|spec)\./i.test(filePath) || /Tests?\//i.test(filePath);
}

function isFrontendFile(filePath = "") {
  return /\/client\/|\.html$|\.css$|\.scss$|\.jsx?$|\.tsx?$/i.test(filePath);
}

function isBackendFile(filePath = "") {
  return /\.cs$|\/ms\/|\/server\//i.test(filePath);
}

function isConfigFile(filePath = "") {
  return /appsettings|web\.config|\.json$|\.ya?ml$|\.config$|\.xml$/i.test(filePath);
}

function isReviewableTextFile(filePath = "") {
  return /\.(cs|js|jsx|ts|tsx|html|json|ya?ml|config)$/i.test(filePath);
}

function scoreReviewPriority(filePath = "") {
  let score = 0;
  if (isConfigFile(filePath)) score += 5;
  if (/auth|security|token|certificate|tls/i.test(filePath)) score += 5;
  if (/consumer|rabbit|queue|broker|payment|billing|banking/i.test(filePath)) score += 4;
  if (/repository|dao|service|program\.cs|startup/i.test(filePath)) score += 3;
  if (isBackendFile(filePath)) score += 2;
  if (isFrontendFile(filePath)) score += 1;
  if (isTestFile(filePath)) score -= 2;
  return score;
}

function selectFilesForPatternChecks(changedFiles, maxFiles = 40) {
  return [...changedFiles]
    .filter((file) => isReviewableTextFile(file.path))
    .sort((a, b) => scoreReviewPriority(b.path) - scoreReviewPriority(a.path))
    .slice(0, maxFiles);
}

function buildMetadataFindings({ pr, changedFiles, threads, workItems, fileSummary, criticalAreas }) {
  const findings = [];
  const approvedReviewers = (pr.reviewers ?? []).filter((reviewer) => reviewer.vote > 0).length;
  const activeThreads = threads.filter((thread) => thread.status === "active").length;
  const hasFrontendChanges = changedFiles.some((file) => isFrontendFile(file.path));
  const hasBackendChanges = changedFiles.some((file) => isBackendFile(file.path));
  const hasFrontendTests = changedFiles.some(
    (file) => isTestFile(file.path) && /\.(js|jsx|ts|tsx)$/i.test(file.path)
  );
  const hasAnyTests = fileSummary.tests > 0;

  if (!pr.title || pr.title.trim().length < 10) {
    findings.push({
      rule: "pr-title-quality",
      label: "Título do PR fraco",
      severity: "medium",
      issue: "Título do PR curto ou genérico demais — dificulta triagem, histórico e entendimento da mudança",
    });
  }

  if (!pr.description || pr.description.trim().length < 50) {
    findings.push({
      rule: "pr-description-quality",
      label: "Descrição do PR insuficiente",
      severity: "high",
      issue: "Descrição do PR insuficiente — faltam contexto, impacto, estratégia de teste e plano de rollback",
    });
  }

  if ((workItems ?? []).length === 0) {
    findings.push({
      rule: "pr-workitems-missing",
      label: "PR sem work item",
      severity: "high",
      issue: "PR sem work items vinculados — reduz rastreabilidade funcional e operacional",
    });
  }

  if (changedFiles.length >= 80) {
    findings.push({
      rule: "pr-size",
      label: "PR grande demais",
      severity: "high",
      issue: `PR com ${changedFiles.length} arquivos alterados — risco alto de review superficial, regressão e merge difícil`,
    });
  } else if (changedFiles.length >= 30) {
    findings.push({
      rule: "pr-size",
      label: "PR acima do ideal",
      severity: "medium",
      issue: `PR com ${changedFiles.length} arquivos alterados — considere fatiar para melhorar review e deploy`,
    });
  }

  if (approvedReviewers === 0) {
    findings.push({
      rule: "pr-approval",
      label: "Sem aprovação",
      severity: "medium",
      issue: "Nenhum reviewer aprovou o PR até o momento",
    });
  }

  if (activeThreads > 0) {
    findings.push({
      rule: "pr-open-threads",
      label: "Threads pendentes",
      severity: "medium",
      issue: `${activeThreads} thread(s) de review ainda estão ativas`,
    });
  }

  if (hasBackendChanges && !hasAnyTests) {
    findings.push({
      rule: "backend-without-tests",
      label: "Backend sem testes",
      severity: "high",
      issue: "Mudanças de backend sem arquivos de teste no mesmo PR — cobertura de regressão insuficiente",
    });
  }

  if (hasFrontendChanges && !hasFrontendTests) {
    findings.push({
      rule: "frontend-without-tests",
      label: "Frontend sem testes",
      severity: "medium",
      issue: "Mudanças de frontend sem testes automatizados no PR",
    });
  }

  if (hasFrontendChanges && hasBackendChanges && changedFiles.length >= 25) {
    findings.push({
      rule: "mixed-concerns-pr",
      label: "PR mistura contextos",
      severity: "medium",
      issue: "PR mistura frontend e backend em volume relevante — aumenta acoplamento do review e do risco de deploy",
    });
  }

  if (criticalAreas.areas.includes("seguranca") && isConfigFile(changedFiles.find((file) => isConfigFile(file.path))?.path)) {
    findings.push({
      rule: "security-config-change",
      label: "Mudança sensível de configuração",
      severity: "high",
      issue: "PR altera configuração sensível/segurança — exige validação explícita de segredos, certificados e TLS",
    });
  }

  return findings;
}

const COMMENTABLE_REVIEW_RULES = new Set([
  "tls-validation-bypass",
  "redis-ttl",
  "sync-over-async",
  "state-mutation-in-catch",
  "async-void",
  "hardcoded-secrets-config",
  "pr-description-quality",
  "pr-workitems-missing",
  "pr-size",
]);

function severityWeight(severity) {
  if (severity === "blocking") return 3;
  if (severity === "high") return 2;
  return 1;
}

async function fetchFileContentAtBranch(repository, branchName, filePath) {
  const url =
    `${buildProjectUrl()}` +
    `/_apis/git/repositories/${repository}/items?path=${encodeURIComponent(filePath)}` +
    `&versionDescriptor.versionType=branch&versionDescriptor.version=${encodeURIComponent(branchName)}` +
    `&api-version=7.0&$format=text`;
  return tfsGetAbsoluteText(url).catch(() => "");
}

function getLineNumber(content, regex) {
  const match = regex.exec(content);
  if (!match || match.index == null) return null;
  return content.slice(0, match.index).split("\n").length;
}

function resolveCommentLine(content, finding) {
  switch (finding.rule) {
    case "tls-validation-bypass":
      return getLineNumber(content, /ServerCertificateValidationCallback/);
    case "redis-ttl": {
      const primaryIssue =
        typeof finding.issue === "string"
          ? finding.issue
          : Array.isArray(finding.issues)
          ? finding.issues[0]
          : finding.issues instanceof Set
          ? [...finding.issues][0]
          : "";
      const snippet = String(primaryIssue ?? "").split(" — ")[0].trim();
      if (snippet) {
        const line = getLineNumber(content, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        if (line) return line;
      }
      return getLineNumber(content, /\b\w*(?:redis|cache)\w*\.Add\(/i);
    }
    case "sync-over-async":
      return (
        getLineNumber(content, /\.Result\b/) ??
        getLineNumber(content, /\.Wait\(/) ??
        getLineNumber(content, /GetAwaiter\(\)\.GetResult\(/)
      );
    case "state-mutation-in-catch":
      return getLineNumber(content, /catch\s*(?:\([^)]*\))?\s*\{/);
    case "async-void":
      return getLineNumber(content, /async\s+void\s+\w+\s*\(/);
    case "hardcoded-secrets-config":
      return getLineNumber(
        content,
        /"(Secret[^"]*|Password[^"]*|ClientSecret|Secret|Token|ConnectionString|CertificateSerialNumber)"/i
      );
    default:
      return null;
  }
}

function buildReviewCommentBody(group) {
  const issues = [...group.issues].slice(0, 2).map((issue) => `- ${issue}`).join("\n");
  const remediationByRule = {
    "tls-validation-bypass":
      "Remoção sugerida: não desabilitar a validação de certificado globalmente. Corrija a cadeia/certificado no ambiente ou use pinning/handler controlado apenas em cenário explícito e seguro.",
    "redis-ttl":
      "Correção sugerida: grave essas chaves com TTL explícito compatível com a janela de reprocessamento/consistência para evitar deduplicação ou cache permanente.",
    "sync-over-async":
      "Correção sugerida: substitua o acesso síncrono por fluxo totalmente assíncrono (`await`) para evitar bloqueio de thread e gargalos sob carga.",
    "state-mutation-in-catch":
      "Correção sugerida: não persista fallback dentro de `catch` genérico sem tratar a causa raiz. Propague/registre o erro e faça correção de integridade de forma explícita e auditável.",
    "async-void":
      "Correção sugerida: troque `async void` por `async Task` e faça o chamador aguardar a inicialização, preservando controle de falha e ordenação.",
    "hardcoded-secrets-config":
      "Correção sugerida: mova segredos/credenciais para secret store, variável de ambiente ou provedor seguro; mantenha no repositório apenas placeholders.",
    "pr-description-quality":
      "Correção sugerida: detalhe objetivo, impacto, estratégia de testes, dependências e rollback na descrição do PR.",
    "pr-workitems-missing":
      "Correção sugerida: vincule o work item correspondente para manter rastreabilidade funcional e operacional.",
    "pr-size":
      "Correção sugerida: fatie a entrega em PRs menores por contexto funcional/técnico para permitir review e rollback mais seguros.",
  };

  return [
    `Problema identificado no review (${group.label}):`,
    issues,
    "",
    remediationByRule[group.rule] ?? "Correção sugerida: revisar a implementação e ajustar o ponto apontado para reduzir risco técnico e operacional.",
  ].join("\n");
}

function buildCommentCandidates(findings, maxComments) {
  const grouped = new Map();
  for (const finding of findings) {
    if (!COMMENTABLE_REVIEW_RULES.has(finding.rule)) continue;
    const key = `${finding.file ?? "__pr__"}|${finding.rule}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        rule: finding.rule,
        label: finding.label,
        severity: finding.severity,
        file: finding.file ?? null,
        issues: new Set(),
      });
    }
    grouped.get(key).issues.add(finding.issue);
  }

  return [...grouped.values()]
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || String(a.file).localeCompare(String(b.file)))
    .slice(0, maxComments);
}

function buildExistingCommentKeys(threads = []) {
  const keys = new Set();
  for (const thread of threads) {
    const filePath = thread.threadContext?.filePath ?? "__pr__";
    for (const comment of thread.comments ?? []) {
      const content = String(comment.content ?? "").trim();
      if (!content) continue;
      keys.add(`${filePath}|${content.slice(0, 120)}`);
    }
  }
  return keys;
}

/**
 * Load pull requests that have a work item as artifact link.
 * Used by toolWorkItemContext in work-item.js (dynamic import to avoid circular).
 */
export async function loadLinkedPullRequestsByItem(workItem, top = 10) {
  const prRefs = extractPullRequestRefs(workItem);
  if (!prRefs.length) return [];

  const settled = await Promise.allSettled(
    prRefs.slice(0, top).map(async (ref) => {
      const target = await resolvePullRequestTarget(ref.id, ref.repo).catch(() => null);
      return target?.pr ? formatPR(target.pr) : null;
    })
  );

  return settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
}

export async function findWorkItemsLinkedToPR(prId, repo) {
  const data = await tfsGet(`/git/repositories/${repo}/pullrequests/${prId}/workitems`);
  const refs = data.value ?? [];
  if (!refs.length) return [];
  const ids = refs.map((r) => r.id);
  const items = await fetchWorkItemsBatch(ids);
  const { formatWorkItem } = await import("../formatters.js");
  return items.map(formatWorkItem);
}

// ─── PR tools ──────────────────────────────────────────────────────────────

const ENGLISH_PR_TERMS_PATTERN = /\b(add|added|adding|change|changes|changing|create|created|creating|fix|fixed|fixing|improve|improved|improving|update|updated|updating|remove|removed|removing|refactor|refactored|chore|feature|bugfix|the|and|with|without|for|from|into|this|that|summary|validation|validations)\b/i;

function assertPortugueseText(value, field) {
  if (ENGLISH_PR_TERMS_PATTERN.test(value)) {
    throw new Error(`O campo ${field} do Pull Request deve ser informado em portugues.`);
  }
}

function formatPortugueseList(items, fallback) {
  const normalized = (items ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!normalized.length) return `- ${fallback}`;
  return normalized.map((item) => `- ${item}`).join("\n");
}

function buildPortuguesePRDescription({ resumo, alteracoes, validacoes, work_item_ids }) {
  const workItems = (work_item_ids ?? []).map((id) => String(id).trim()).filter(Boolean);
  return [
    "## Resumo",
    resumo.trim(),
    "",
    "## Alteracoes realizadas",
    formatPortugueseList(alteracoes, "Alteracoes descritas no resumo acima."),
    "",
    "## Validacoes realizadas",
    formatPortugueseList(validacoes, "Validacoes nao informadas."),
    "",
    "## Itens relacionados",
    workItems.length ? workItems.map((id) => `- #${id}`).join("\n") : "- Nenhum item informado.",
  ].join("\n");
}

function parsePortuguesePRInput(args, { includeBranches }) {
  const schema = z.strictObject({
    ...(includeBranches
      ? {
          source_branch: z.string().min(1),
          target_branch: z.string().min(1),
        }
      : { id: z.union([z.number(), z.string()]) }),
    repo: z.string().optional(),
    titulo: z.string().min(8),
    resumo: z.string().min(20),
    alteracoes: z.array(z.string().min(1)).max(20).optional(),
    validacoes: z.array(z.string().min(1)).max(20).optional(),
    work_item_ids: z.array(z.union([z.number(), z.string()])).max(20).optional(),
    dry_run: z.boolean().default(false),
    confirm: z.boolean().optional(),
    reason: z.string().optional(),
    requestedBy: z.string().optional(),
    requested_by: z.string().optional(),
    confirm_high_impact: z.string().optional(),
  });
  const input = schema.parse(args);
  assertPortugueseText(input.titulo, "titulo");
  assertPortugueseText(input.resumo, "resumo");
  for (const item of [...(input.alteracoes ?? []), ...(input.validacoes ?? [])]) {
    assertPortugueseText(item, "conteudo");
  }
  input.work_item_ids = normalizePRWorkItemIds(input.work_item_ids);
  return input;
}

function summarizeWorkItemLinkMutation(workItemLinks) {
  const partial = workItemLinks.status === "partial" || workItemLinks.status === "failed";
  return {
    workItemLinks,
    partial,
    warnings: partial
      ? [`${workItemLinks.failed.length} vínculo(s) de work item não foram aplicados.`]
      : [],
  };
}

export async function toolCreatePR(args) {
  const input = parsePortuguesePRInput(args, { includeBranches: true });
  const repository = resolveRepo(input.repo);
  const sourceBranch = input.source_branch.replace(/^refs\/heads\//, "");
  const targetBranch = input.target_branch.replace(/^refs\/heads\//, "");
  const description = buildPortuguesePRDescription(input);
  const controls = normalizeMutationControls(input);
  const context = getRequestContext();
  const impact = detectHighImpact(repository, sourceBranch, targetBranch);
  const plan = buildMutationPlan({
    tool: "tfs_create_pr",
    target: { repository, sourceBranch, targetBranch },
    operation: "create pull request",
    changes: { title: input.titulo, description, workItemIds: input.work_item_ids ?? [] },
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: targetBranch,
    authAlias: context.authAlias,
    repo: repository,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const result = await tfsPost(`/git/repositories/${repository}/pullrequests`, {
        sourceRefName: `refs/heads/${sourceBranch}`,
        targetRefName: `refs/heads/${targetBranch}`,
        title: input.titulo,
        description,
      });
      const workItemLinks = await ensurePullRequestWorkItemLinks({
        pr: result,
        repository,
        pullRequestId: result.pullRequestId,
        workItemIds: input.work_item_ids,
      });
      return {
        pullRequestId: result.pullRequestId,
        title: result.title,
        repository,
        sourceBranch,
        targetBranch,
        ...summarizeWorkItemLinkMutation(workItemLinks),
        url: `${buildProjectUrl(`/_git/${repository}/pullrequest/${result.pullRequestId}`)}`,
      };
    },
  });
}

export async function toolUpdatePR(args) {
  const input = parsePortuguesePRInput(args, { includeBranches: false });
  const { repository, pr, parsedRef } = await resolvePullRequestTarget(input.id, input.repo);
  const formattedPr = formatPR(pr);
  const description = buildPortuguesePRDescription(input);
  const controls = normalizeMutationControls(input);
  const context = getRequestContext();
  const impact = detectHighImpact(repository, formattedPr.sourceBranch, formattedPr.targetBranch);
  const plan = buildMutationPlan({
    tool: "tfs_update_pr",
    target: { pullRequestId: parsedRef.id, repository, sourceBranch: formattedPr.sourceBranch, targetBranch: formattedPr.targetBranch },
    operation: "update pull request metadata",
    changes: { title: input.titulo, description, workItemIds: input.work_item_ids ?? [] },
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: String(parsedRef.id),
    authAlias: context.authAlias,
    repo: repository,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const result = await tfsPatch(`/git/repositories/${repository}/pullrequests/${parsedRef.id}`, {
        title: input.titulo,
        description,
      });
      const workItemLinks = await ensurePullRequestWorkItemLinks({
        pr: { ...pr, ...result, repository: result.repository ?? pr.repository },
        repository,
        pullRequestId: parsedRef.id,
        workItemIds: input.work_item_ids,
      });
      return {
        pullRequestId: result.pullRequestId,
        title: result.title,
        description,
        ...summarizeWorkItemLinkMutation(workItemLinks),
        url: `${buildProjectUrl(`/_git/${repository}/pullrequest/${result.pullRequestId}`)}`,
      };
    },
  });
}

export async function toolListPRs(args) {
  const {
    repo,
    status = "active",
    created_by,
    target_branch,
    top = 10,
  } = z
    .strictObject({
      repo: z.string().optional(),
      status: z.enum(["active", "completed", "abandoned", "all"]).default("active"),
      created_by: z.string().optional(),
      target_branch: z.string().optional(),
      top: z.number().int().min(1).max(100).default(10),
    })
    .parse(args);

  const repositories = repo ? [resolveRepo(repo)] : getConfiguredRepositories();
  const queryParams = {
    "$top": top,
  };
  if (status !== "all") queryParams["searchCriteria.status"] = status;
  if (created_by) queryParams["searchCriteria.reviewerId"] = created_by;
  if (target_branch)
    queryParams["searchCriteria.targetRefName"] = `refs/heads/${target_branch}`;

  const settled = await Promise.allSettled(
    repositories.map((repository) => tfsGet(`/git/repositories/${repository}/pullrequests`, queryParams))
  );

  const prs = settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => (result.value.value ?? []).map(formatPR));

  const firstFailure = settled.find((result) => result.status === "rejected");
  if (!prs.length && firstFailure?.status === "rejected") throw firstFailure.reason;

  return sortPullRequestsDescending(prs).slice(0, top);
}

export async function toolGetPR(args) {
  const { id, repo } = z
    .strictObject({ id: z.union([z.number(), z.string()]), repo: z.string().optional() })
    .parse(args);
  const { repository, pr, parsedRef } = await resolvePullRequestTarget(id, repo);
  const [threadsData, iterationsData, linkedWorkItems] = await Promise.all([
    tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/threads`),
    tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/iterations`),
    findWorkItemsLinkedToPR(parsedRef.id, repository).catch(() => []),
  ]);
  const iterations = iterationsData.value ?? [];
  const latestIteration = iterations.at(-1);
  const changesData = latestIteration
    ? await tfsGet(
      `/git/repositories/${repository}/pullrequests/${parsedRef.id}/iterations/${latestIteration.id}/changes`
    )
    : { changeEntries: [] };

  const threads = (threadsData.value ?? []).map((thread) => ({
    id: thread.id,
    status: thread.status,
    isDeleted: Boolean(thread.isDeleted),
    file: thread.threadContext?.filePath ?? null,
    startLine: thread.threadContext?.rightFileStart?.line ?? null,
    endLine: thread.threadContext?.rightFileEnd?.line ?? null,
    comments: (thread.comments ?? [])
      .filter((comment) => !comment.isDeleted)
      .map((comment) => ({
        id: comment.id,
        author: comment.author?.displayName ?? "",
        type: comment.commentType ?? "",
        publishedDate: comment.publishedDate ?? comment.lastUpdatedDate ?? null,
        content: comment.content ?? "",
      })),
  }));

  return {
    ...formatPR(pr),
    latestIteration: latestIteration
      ? { id: latestIteration.id, sourceCommit: latestIteration.sourceRefCommit?.commitId ?? null }
      : null,
    files: (changesData.changeEntries ?? []).map((change) => ({
      path: change.item?.path ?? "",
      changeType: change.changeType ?? "",
    })),
    workItems: linkedWorkItems.map((item) => ({ id: item.id, title: item.title, state: item.state, type: item.type })),
    threads,
  };
}

export async function toolReviewPR(args) {
  const {
    id,
    repo,
    include_diff = true,
    include_threads = true,
    run_pattern_checks = true,
  } = z
    .strictObject({
      id: z.union([z.number(), z.string()]),
      repo: z.string().optional(),
      include_diff: z.boolean().default(true),
      include_threads: z.boolean().default(true),
      run_pattern_checks: z.boolean().default(true),
    })
    .parse(args);

  const { repository, pr, parsedRef } = await resolvePullRequestTarget(id, repo);
  const [threadsData, iterationData, linkedWorkItems] = await Promise.all([
    include_threads
      ? tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/threads`)
      : Promise.resolve({ value: [] }),
    include_diff
      ? tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/iterations`)
      : Promise.resolve({ value: [] }),
    findWorkItemsLinkedToPR(parsedRef.id, repository).catch(() => []),
  ]);

  const iterations = iterationData.value ?? [];
  const latestIter = iterations.at(-1);
  const sourceBranch = pr.sourceRefName?.replace("refs/heads/", "") ?? "HEAD";

  let changedFiles = [];
  let allFindings = [];

  if (latestIter && include_diff) {
    const changesData = await tfsGet(
      `/git/repositories/${repository}/pullrequests/${parsedRef.id}/iterations/${latestIter.id}/changes`
    );
    changedFiles = (changesData.changeEntries ?? []).map((c) => ({
      path: c.item?.path ?? "",
      changeType: c.changeType,
    }));

    if (run_pattern_checks) {
      const fileContents = await Promise.allSettled(
        selectFilesForPatternChecks(changedFiles).map(async (cf) => {
          try {
            const encPath = encodeURIComponent(cf.path);
            const url = `${buildProjectUrl()}/_apis/git/repositories/${repository}/items?path=${encPath}&versionDescriptor.versionType=branch&versionDescriptor.version=${encodeURIComponent(sourceBranch)}&api-version=7.0&$format=text`;
            const text = await tfsGetAbsoluteText(url);
            return { path: cf.path, content: text };
          } catch {
            return null;
          }
        })
      );

        for (const r of fileContents) {
          if (r.status === "fulfilled" && r.value) {
            const checks = runPatternChecks(r.value.content, r.value.path);
            allFindings.push(...checks.map((f) => ({ ...f, file: r.value.path })));
          }
        }
      }
  }

  const threads = (threadsData.value ?? []).filter((t) => t.status !== "byDesign");
  const fileSummary = summarizeFileChanges(changedFiles);
  const criticalAreas = detectCriticalFileAreas(changedFiles);
  const metadataFindings = buildMetadataFindings({
    pr: formatPR(pr),
    changedFiles,
    threads,
    workItems: linkedWorkItems,
    fileSummary,
    criticalAreas,
  });
  allFindings.push(...metadataFindings);
  const openComments = threads.filter((t) => t.status === "active").length;
  const reviewScore = scoreReview(allFindings, changedFiles.length);
  const specialistReview = buildSpecialistReview({
    title: formatPR(pr).title,
    description: formatPR(pr).description,
    changedFiles,
    repo: repository,
    workItems: linkedWorkItems,
  });

  return {
    pr: formatPR(pr),
    changedFiles,
    openComments,
    reviewScore,
    reviewFindings: allFindings,
    fileSummary,
    criticalAreas,
    specialistReview,
    workItems: linkedWorkItems,
  };
}

export async function toolAddPRComment(args) {
  const { id, repo, comment, file_path, line, dry_run, confirm, reason, requestedBy, requested_by, confirm_high_impact } = z
    .strictObject({
      id: z.union([z.number(), z.string()]),
      repo: z.string().optional(),
      comment: z.string().min(1),
      file_path: z.string().optional(),
      line: z.number().int().positive().optional(),
      dry_run: z.boolean().default(false),
      confirm: z.boolean().optional(),
      reason: z.string().optional(),
      requestedBy: z.string().optional(),
      requested_by: z.string().optional(),
      confirm_high_impact: z.string().optional(),
    })
    .parse(args);

  const parsedArgs = { dry_run, confirm, reason, requestedBy, requested_by, confirm_high_impact };
  const { repository, pr, parsedRef } = await resolvePullRequestTarget(id, repo);
  const formattedPr = formatPR(pr);
  const threadPayload = {
    comments: [{ parentCommentId: 0, content: comment, commentType: 1 }],
    status: 1,
  };
  if (file_path) {
    threadPayload.threadContext = {
      filePath: file_path,
      ...(line != null ? { rightFileStart: { line, offset: 1 }, rightFileEnd: { line, offset: 2 } } : {}),
    };
  }

  const controls = normalizeMutationControls(parsedArgs);
  const impact = detectHighImpact(
    repository,
    formattedPr.title,
    formattedPr.sourceBranch,
    formattedPr.targetBranch,
    file_path
  );
  const context = getRequestContext();
  const plan = buildMutationPlan({
    tool: "tfs_add_pr_comment",
    target: {
      pullRequestId: parsedRef.id,
      title: formattedPr.title,
      repository,
      sourceBranch: formattedPr.sourceBranch,
      targetBranch: formattedPr.targetBranch,
      filePath: file_path ?? null,
      line: line ?? null,
      url: formattedPr.url,
    },
    operation: "add pull request comment",
    changes: [
      {
        field: file_path ? "threadContext/comment" : "comment",
        filePath: file_path ?? null,
        line: line ?? null,
        valuePreview: comment.length > 160 ? `${comment.slice(0, 160)}...[truncated:${comment.length}]` : comment,
      },
    ],
    controls,
    highImpact: impact.highImpact,
    highImpactMatch: impact.match,
    highImpactConfirmation: String(parsedRef.id),
    authAlias: context.authAlias,
    repo: repository,
  });

  return executeGuardedMutation({
    plan,
    controls,
    apply: async () => {
      const result = await tfsPost(
        `/git/repositories/${repository}/pullrequests/${parsedRef.id}/threads`,
        threadPayload
      );
      return { threadId: result.id, status: result.status, comment };
    },
  });
}

export async function toolCommentReviewFindings(args) {
  const {
    id,
    repo,
    dry_run = false,
    include_pr_hygiene = true,
    max_comments = 6,
    confirm,
    reason,
    requestedBy,
    requested_by,
    confirm_high_impact,
  } = z
    .strictObject({
      id: z.union([z.number(), z.string()]),
      repo: z.string().optional(),
      dry_run: z.boolean().default(false),
      include_pr_hygiene: z.boolean().default(true),
      max_comments: z.number().int().min(1).max(20).default(6),
      confirm: z.boolean().optional(),
      reason: z.string().optional(),
      requestedBy: z.string().optional(),
      requested_by: z.string().optional(),
      confirm_high_impact: z.string().optional(),
    })
    .parse(args);

  const { repository, parsedRef } = await resolvePullRequestTarget(id, repo);
  const review = await toolReviewPR({
    id: parsedRef.id,
    repo: repository,
    include_diff: true,
    include_threads: true,
    run_pattern_checks: true,
  });
  const prDetails = await tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}`);
  const sourceBranch = prDetails.sourceRefName?.replace("refs/heads/", "") ?? "HEAD";
  const threadsData = await tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/threads`).catch(() => ({ value: [] }));
  const existingKeys = buildExistingCommentKeys(threadsData.value ?? []);

  let findings = review.reviewFindings;
  if (!include_pr_hygiene) {
    findings = findings.filter((finding) => !finding.rule.startsWith("pr-"));
  }

  const candidates = buildCommentCandidates(findings, max_comments);
  const fileCache = new Map();
  const plannedComments = [];

  for (const candidate of candidates) {
    let line = null;
    if (candidate.file) {
      if (!fileCache.has(candidate.file)) {
        fileCache.set(candidate.file, await fetchFileContentAtBranch(repository, sourceBranch, candidate.file));
      }
      line = resolveCommentLine(fileCache.get(candidate.file), candidate);
    }

    const comment = buildReviewCommentBody(candidate);
    const dedupeKey = `${candidate.file ?? "__pr__"}|${comment.slice(0, 120)}`;
    if (existingKeys.has(dedupeKey)) continue;

    plannedComments.push({
      rule: candidate.rule,
      severity: candidate.severity,
      file_path: candidate.file,
      line,
      comment,
    });
  }

  if (dry_run) {
    return {
      pullRequestId: id,
      dryRun: true,
      totalFindings: review.reviewFindings.length,
      plannedComments,
    };
  }

  const appliedComments = [];
  const blockedComments = [];
  for (const entry of plannedComments) {
    const result = await toolAddPRComment({
      id: parsedRef.id,
      repo: repository,
      comment: entry.comment,
      file_path: entry.file_path ?? undefined,
      line: entry.line ?? undefined,
      dry_run,
      confirm,
      reason,
      requestedBy,
      requested_by,
      confirm_high_impact,
    });
    if (result?.willMutate === false) {
      blockedComments.push({
        ...entry,
        blockReasons: result.blockReasons ?? [],
        correlationId: result.correlationId,
      });
      continue;
    }
    appliedComments.push({
      ...entry,
      threadId: result.threadId,
      status: result.status,
    });
  }

  return {
    pullRequestId: id,
    dryRun: false,
    totalFindings: review.reviewFindings.length,
    appliedComments,
    blockedComments,
  };
}

function buildPRReviewChecklist({ pr, workItems, changedFiles, fileSummary, criticalAreas }) {
  const checklist = [];

  if (!pr.description || pr.description.length < 50)
    checklist.push("Adicionar descrição detalhada ao PR (mínimo 50 chars)");

  if (workItems.length === 0)
    checklist.push("Vincular ao menos um work item ao PR");

  const openWorkItems = workItems.filter((wi) => !["Done", "Closed", "Resolved"].includes(wi.state));
  if (openWorkItems.length > 0)
    checklist.push(`Verificar status dos work items vinculados: ${openWorkItems.map((wi) => `#${wi.id}`).join(", ")}`);

  if (criticalAreas.areas.length > 0)
    checklist.push(`Revisão extra em áreas críticas: ${criticalAreas.areas.join(", ")}`);

  if (changedFiles.length > 20)
    checklist.push("PR com muitos arquivos — considere dividir em PRs menores");

  checklist.push("Confirmar que testes passaram (CI verde)");
  checklist.push("Verificar cobertura de código nos módulos alterados");

  return checklist;
}

export async function toolPreparePRReview(args) {
  const { id, repo, include_code_review = true, include_pipeline = true } = z
    .strictObject({
      id: z.union([z.number(), z.string()]),
      repo: z.string().optional(),
      include_code_review: z.boolean().default(true),
      include_pipeline: z.boolean().default(true),
    })
    .parse(args);

  const { repository, pr, parsedRef } = await resolvePullRequestTarget(id, repo);
  const [iterationsData, workItemsData, threadsData] = await Promise.all([
    tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/iterations`),
    tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/workitems`),
    include_code_review
      ? tfsGet(`/git/repositories/${repository}/pullrequests/${parsedRef.id}/threads`).catch(() => ({ value: [] }))
      : Promise.resolve({ value: [] }),
  ]);

  const iterations = iterationsData.value ?? [];
  const latestIter = iterations.at(-1);
  let changedFiles = [];

  if (latestIter) {
    const changesData = await tfsGet(
      `/git/repositories/${repository}/pullrequests/${parsedRef.id}/iterations/${latestIter.id}/changes`
    );
    changedFiles = (changesData.changeEntries ?? []).map((c) => ({
      path: c.item?.path ?? "",
      changeType: c.changeType,
    }));
  }

  const wiRefs = workItemsData.value ?? [];
  const workItems = wiRefs.length ? await fetchWorkItemsBatch(wiRefs.map((r) => r.id)) : [];
  const { formatWorkItem } = await import("../formatters.js");
  const formattedWorkItems = workItems.map(formatWorkItem);

  const fileSummary = summarizeFileChanges(changedFiles);
  const criticalAreas = detectCriticalFileAreas(changedFiles);
  const formattedPr = formatPR(pr);
  const specialistReview = buildSpecialistReview({
    title: formattedPr.title,
    description: formattedPr.description,
    changedFiles,
    repo: repository,
    workItems: formattedWorkItems,
  });
  const checklist = buildPRReviewChecklist({
    pr: formattedPr,
    workItems: formattedWorkItems,
    changedFiles,
    fileSummary,
    criticalAreas,
  });

  const threads = (threadsData.value ?? []).filter((t) => t.status !== "byDesign");
  const openThreads = threads.filter((t) => t.status === "active");
  const reviewerCount = (pr.reviewers ?? []).length;
  const metadataFindings = buildMetadataFindings({
    pr: formattedPr,
    changedFiles,
    threads,
    workItems: formattedWorkItems,
    fileSummary,
    criticalAreas,
  });
  const codeReviewScore = include_code_review ? scoreReview(metadataFindings, changedFiles.length) : null;

  const signals = {
    reviewerCount,
    threadCount: threads.length,
    workItemCount: formattedWorkItems.length,
    fileSummary,
    criticalAreas,
    codeReviewScore,
  };

  const risks = [];
  if (reviewerCount === 0) risks.push("PR sem revisores aprovados");
  if (openThreads.length > 0) risks.push(`${openThreads.length} comentário(s) pendente(s)`);
  if (criticalAreas.areas.length > 0)
    risks.push(`Mudanças em áreas críticas: ${criticalAreas.areas.slice(0, 3).join(", ")}`);

  const suggestedFocus = [
    "Verificar lógica de negócio e edge cases",
    "Confirmar tratamento de erros e logging",
    "Garantir que não há segredos hardcoded",
    ...specialistReview.recommendedNextActions.slice(0, 3),
    ...(criticalAreas.areas.length > 0 ? [`Revisão extra: ${criticalAreas.areas.slice(0, 2).join(", ")}`] : []),
  ];
  const pipeline = include_pipeline
    ? await loadPullRequestPipelines({
        pr,
        repository,
        pullRequestId: parsedRef.id,
        top: 3,
      }).catch((err) => ({
          unavailable: true,
          error: err instanceof Error ? err.message : String(err),
        }))
    : null;

  return {
    pullRequest: formattedPr,
    linkedWorkItems: formattedWorkItems,
    signals,
    risks,
    checklist,
    suggestedFocus,
    specialistReview,
    codeReview: include_code_review ? { openComments: openThreads.length, totalThreads: threads.length } : null,
    pipeline,
  };
}
