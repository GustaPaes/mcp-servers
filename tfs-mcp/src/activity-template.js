import { stripHtml } from "./formatters.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (value == null) return [];
  return String(value)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeParagraph(value, fallback = "Não há") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function compressText(value, maxLength = 220) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function shouldSummarize({ detailLevel, estimatedChangedLines, technicalCriteria, affectedLocations }) {
  if (detailLevel === "summary") return true;
  if (detailLevel === "specific") return false;
  return (estimatedChangedLines ?? 0) > 50 || technicalCriteria.length > 6 || affectedLocations.length > 4;
}

function normalizeMustText(value, summaryMode) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const withoutPrefix = text.replace(/^deve\s+/i, "").trim();
  const finalText = summaryMode ? compressText(withoutPrefix) : withoutPrefix;
  return `<b>Deve</b> ${escapeHtml(finalText)}`;
}

function normalizePlainMustText(value, summaryMode) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const withoutPrefix = text.replace(/^deve\s+/i, "").trim();
  const finalText = summaryMode ? compressText(withoutPrefix) : withoutPrefix;
  return `**Deve** ${finalText}`;
}

function toHtmlList(items, { summaryMode = false, emptyText = "Não há", mustPrefix = false, bulletList = false } = {}) {
  const normalized = asList(items).map((item) =>
    mustPrefix ? normalizeMustText(item, summaryMode) : escapeHtml(summaryMode ? compressText(item) : item)
  ).filter(Boolean);
  if (!normalized.length) return escapeHtml(emptyText);
  if (bulletList) return `<ul>${normalized.map((item) => `<li>${item}</li>`).join("")}</ul>`;
  return normalized.join("<br>");
}

function toMarkdownList(items, { summaryMode = false, emptyText = "Não há", mustPrefix = false, bulletList = false } = {}) {
  const normalized = asList(items).map((item) =>
    mustPrefix ? normalizePlainMustText(item, summaryMode) : summaryMode ? compressText(item) : item
  ).filter(Boolean);
  if (!normalized.length) return emptyText;
  if (bulletList) return normalized.map((item) => `- ${item}`).join("\n");
  return normalized.join("\n");
}

function extractBetween(text, startLabel, endLabels = []) {
  const normalized = stripHtml(text ?? "").replace(/\r/g, "");
  if (!normalized) return "";
  const startRegex = new RegExp(startLabel, "i");
  const startMatch = startRegex.exec(normalized);
  if (!startMatch) return "";
  const startIndex = startMatch.index + startMatch[0].length;
  const rest = normalized.slice(startIndex);

  let endIndex = rest.length;
  for (const endLabel of endLabels) {
    const endRegex = new RegExp(endLabel, "i");
    const endMatch = endRegex.exec(rest);
    if (endMatch && endMatch.index < endIndex) endIndex = endMatch.index;
  }

  return rest.slice(0, endIndex).trim();
}

export function parseBusinessDescription(description, title = "") {
  const normalized = stripHtml(description ?? "").replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /Enquanto\s+(.+?),\s*eu quero\s+(.+?),\s*para que eu\s+(.+?)(?:Critérios de Aceite de Negócio:|Definições Visuais:|$)/i
  );

  const businessAcceptance = extractBetween(
    description,
    "Critérios de Aceite de Negócio:\\s*",
    ["Definições Visuais:"]
  );
  const visualDefinitions = extractBetween(description, "Definições Visuais:\\s*", []);

  return {
    actor: match?.[1]?.trim() ?? "a definir",
    intent: match?.[2]?.trim() ?? title ?? "a definir",
    outcome: match?.[3]?.trim() ?? "atingir o objetivo do item",
    businessAcceptanceCriteria: asList(businessAcceptance),
    visualDefinitions: normalizeParagraph(visualDefinitions || "Não há"),
  };
}

export function buildBusinessTemplate(input = {}) {
  const businessAcceptanceCriteria = asList(input.businessAcceptanceCriteria);
  const summaryMode = shouldSummarize({
    detailLevel: input.detailLevel,
    estimatedChangedLines: input.estimatedChangedLines,
    technicalCriteria: [],
    affectedLocations: [],
  });

  const actor = normalizeParagraph(input.actor, "a definir");
  const intent = normalizeParagraph(input.intent, "a definir");
  const outcome = normalizeParagraph(input.outcome, "atingir o objetivo do item");
  const visualDefinitions = normalizeParagraph(input.visualDefinitions, "Não há");

  const html = [
    `<b>Enquanto</b> ${escapeHtml(actor)}`,
    `<b>eu quero</b> ${escapeHtml(intent)}`,
    `<b>para que eu</b> ${escapeHtml(outcome)}`,
    "",
    "<b>Critérios de Aceite de Negócio:</b>",
    toHtmlList(businessAcceptanceCriteria, { summaryMode, emptyText: "Não há", mustPrefix: true, bulletList: true }),
    "",
    `<b>Definições Visuais:</b><br>${toHtmlList(asList(input.visualDefinitions), { summaryMode, emptyText: "Não há", bulletList: true })}`,
  ].join("<br>");

  const markdown = [
    `**Enquanto** ${actor}`,
    `**eu quero** ${intent}`,
    `**para que eu** ${outcome}`,
    "",
    "**Critérios de Aceite de Negócio:**",
    toMarkdownList(businessAcceptanceCriteria, { summaryMode, emptyText: "Não há", mustPrefix: true, bulletList: true }),
    "",
    `**Definições Visuais:**`,
    toMarkdownList(asList(input.visualDefinitions), { summaryMode, emptyText: "Não há", bulletList: true }),
  ].join("\n");

  return { html, markdown, summaryMode };
}

export function buildTechnicalTemplate(input = {}) {
  const technicalAcceptanceCriteria = asList(input.technicalAcceptanceCriteria);
  const affectedLocations = asList(input.affectedLocations);
  const technicalDependencies = asList(input.technicalDependencies);
  const summaryMode = shouldSummarize({
    detailLevel: input.detailLevel,
    estimatedChangedLines: input.estimatedChangedLines,
    technicalCriteria: technicalAcceptanceCriteria,
    affectedLocations,
  });

  const html = [
    "<b>Dependências Técnicas:</b>",
    toHtmlList(technicalDependencies, { summaryMode, emptyText: "Não há", bulletList: true }),
    "",
    "<b>Critérios de Aceite Técnico:</b>",
    toHtmlList(technicalAcceptanceCriteria, { summaryMode, emptyText: "Não há", mustPrefix: true, bulletList: true }),
    "",
    "<b>Locais Afetados:</b>",
    toHtmlList(affectedLocations, { summaryMode, emptyText: "Não há", bulletList: true }),
  ].join("<br>");

  const markdown = [
    "**Dependências Técnicas:**",
    toMarkdownList(technicalDependencies, { summaryMode, emptyText: "Não há", bulletList: true }),
    "",
    "**Critérios de Aceite Técnico:**",
    toMarkdownList(technicalAcceptanceCriteria, { summaryMode, emptyText: "Não há", mustPrefix: true, bulletList: true }),
    "",
    "**Locais Afetados:**",
    toMarkdownList(affectedLocations, { summaryMode, emptyText: "Não há", bulletList: true }),
  ].join("\n");

  return { html, markdown, summaryMode };
}

export function buildActivityTemplate(input = {}) {
  const business = buildBusinessTemplate(input);
  const technical = buildTechnicalTemplate(input);

  return {
    title: input.title ?? "",
    workItemType: input.workItemType ?? "",
    business,
    technical,
    combined: {
      html: `${business.html}<br><br>${technical.html}`,
      markdown: `${business.markdown}\n\n${technical.markdown}`,
    },
  };
}
