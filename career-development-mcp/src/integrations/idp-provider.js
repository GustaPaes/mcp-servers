import { createHash } from "node:crypto";
import { redactSensitiveValue } from "@gustapaes/mcp-runtime";
import { DEFAULT_IDP_ROUTES } from "./remote-config.js";

export function canonicalHash(value) {
  const canonical = (item) =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, canonical(item[key])]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function numericId(value) {
  const candidate =
    typeof value === "object" && value !== null ? value.id : value;
  if (
    !/^[1-9]\d{0,14}$/.test(String(candidate)) ||
    !Number.isSafeInteger(Number(candidate))
  )
    throw new Error("The provider returned an invalid numeric identifier.");
  return String(candidate);
}

function text(value, max = 8000) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max)
    throw new Error(
      "Provider text exceeds the supported limit or has an invalid shape.",
    );
  return redactSensitiveValue(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .trim(),
  );
}

function array(value, limit = 100) {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error(
      "Provider collection has an unsupported shape or exceeds the supported limit. Refine the query.",
    );
  return value;
}

function payload(value) {
  return value?.data ?? value;
}
function status(value) {
  return text(value || "UNKNOWN", 64);
}
function date(value) {
  return value == null ? null : text(value, 64);
}

export function normalizePlan(raw) {
  return {
    id: numericId(raw.id),
    title: text(raw.name, 512),
    description: text(raw.description),
    status: status(raw.status),
    startDate: date(raw.startDate),
    endDate: date(raw.endDate),
  };
}
export function normalizeAction(raw, planId) {
  if (numericId(raw.plan) !== planId)
    throw new Error("Provider action belongs to a different plan.");
  return {
    id: numericId(raw.id),
    planId,
    title: text(raw.title, 512),
    description: text(raw.description),
    dueDate: date(raw.dueDate),
    status: status(raw.status),
  };
}

export function createIdpProvider(http, routes = DEFAULT_IDP_ROUTES) {
  const route = (key, ids = {}, query = {}) => {
    const pathname = routes[key].replace(/\{(planId|actionId)\}/g, (_, name) =>
      encodeURIComponent(numericId(ids[name])),
    );
    const search = new URLSearchParams(query).toString();
    return search ? `${pathname}?${search}` : pathname;
  };
  const self = async () => {
    // Re-read identity for each top-level operation, including preview/application.
    const response = payload(await http(route("self")));
    return numericId(response?.employee);
  };
  return {
    self,
    async list({ page = 0, limit = 25 } = {}) {
      const owner = await self();
      const raw = payload(
        await http(
          route(
            "plans",
            {},
            { pageNumber: page, pageSize: limit, employee: owner },
          ),
        ),
      );
      const items = array(raw?.content ?? raw, limit).map((item) =>
        normalizePlan(item.plan ?? item),
      );
      return {
        items,
        page,
        limit,
        hasMore:
          typeof raw?.last === "boolean" ? !raw.last : items.length === limit,
      };
    },
    async get(planId, { comments = false, page = 0, limit = 25 } = {}) {
      const owner = await self();
      const detail = payload(await http(route("plan", { planId })));
      const rawPlan = detail?.plan;
      if (
        !rawPlan ||
        numericId(rawPlan.id) !== planId ||
        numericId(rawPlan.employee) !== owner
      )
        throw new Error(
          "The requested plan is unavailable or does not belong to the authenticated employee.",
        );
      const rawActions = array(
        payload(await http(route("actions", {}, { plan: planId }))),
      ).map((item) => item.action);
      const actions = rawActions.map((action) =>
        normalizeAction(action, planId),
      );
      const result = {
        plan: normalizePlan(rawPlan),
        actions,
        revision: canonicalHash({ plan: rawPlan, actions: rawActions }),
        capturedAt: new Date().toISOString(),
      };
      if (comments) {
        const rawComments = payload(
          await http(
            route(
              "comments",
              {},
              { plan: planId, pageNumber: page, pageSize: limit },
            ),
          ),
        );
        const items = array(rawComments?.content ?? rawComments, limit);
        result.comments = items.map((item) => {
          const c = item.comment ?? item;
          return {
            id: numericId(c.id),
            text: text(c.text),
            createdAt: date(c.createdAt),
          };
        });
        result.commentsHasMore =
          typeof rawComments?.last === "boolean"
            ? !rawComments.last
            : items.length === limit;
      }
      return { data: result, rawPlan, rawActions, employee: owner };
    },
    async execute(operation, target, changes, current) {
      if (operation === "plan_create") {
        return http(route("plans"), {
          method: "POST",
          body: {
            plan: {
              employee: Number(current.employee),
              name: changes.title,
              description: changes.description,
              startDate: changes.startDate,
              endDate: changes.endDate,
              criteria: [],
              perfEvalAssessment: null,
              tags: [],
              createdFromPerfEvalAssessment: false,
            },
            actions: changes.actions.map((a) => ({
              title: a.title,
              description: a.description,
              dueDate: a.dueDate,
            })),
            expectations: changes.expectations,
            employeeSelection: null,
          },
        });
      }
      if (operation === "plan_update") {
        const p = current.rawPlan;
        return http(route("plan", target), {
          method: "PUT",
          body: {
            name: changes.title ?? p.name,
            description: changes.description ?? p.description,
            startDate: changes.startDate ?? p.startDate,
            endDate: changes.endDate ?? p.endDate,
            criteria: p.criteria ?? [],
            perfEvalAssessment: p.perfEvalAssessment ?? null,
            tags: p.tags ?? [],
            skills: p.skills ?? [],
          },
        });
      }
      if (operation === "action_create")
        return http(route("actionCreate"), {
          method: "POST",
          body: {
            title: changes.title,
            description: changes.description,
            dueDate: changes.dueDate,
            status: "PENDING",
            new: true,
            plan: Number(target.planId),
          },
        });
      if (operation === "action_update") {
        const a = current.rawActions.find(
          (a) => numericId(a.id) === target.actionId,
        );
        return http(route("action", target), {
          method: "PUT",
          body: {
            id: Number(target.actionId),
            plan: Number(target.planId),
            growthTrack: a.growthTrack ?? null,
            title: changes.title ?? a.title,
            description: changes.description ?? a.description,
            dueDate: changes.dueDate ?? a.dueDate,
            status: a.status,
          },
        });
      }
      if (operation === "action_status")
        return http(route("actionStatus", target), {
          method: "PUT",
          body: { status: changes.status },
        });
      if (operation === "comment_add")
        return http(route("comments"), {
          method: "POST",
          body: { form: { plan: Number(target.planId), text: changes.text } },
          form: true,
        });
      throw new Error("Unsupported remote operation.");
    },
  };
}
