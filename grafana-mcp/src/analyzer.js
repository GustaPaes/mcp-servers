import { z } from 'zod';
import { GrafanaError } from './client.js';

const text = z.string().max(200).nullable();
export const summarySchema = z.object({
  uid: text, title: text,
  panels: z.array(z.object({
    id: z.number().int().nullable(), title: text, type: text,
    activeQueries: z.number().int().nonnegative(),
    hasDashboardVariables: z.boolean(), hasTransformations: z.boolean(), hasThresholds: z.boolean(),
  }).strict()).max(200),
}).strict();
export const candidatesSchema = z.object({ candidates: z.array(z.object({
  panelId: z.number().int().nullable(), title: text, eligibleForDirectReuse: z.boolean(),
  blockers: z.array(z.string().max(200)).max(4), warnings: z.array(z.string().max(200)).max(4),
}).strict()).max(200) }).strict();
const safeText = value => typeof value === 'string'
  ? value.replace(/(?:Bearer\s+\S+|\b(?:glsa_|gh[pousr]_)[A-Za-z0-9_-]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b)/gi, '[REDACTED]').slice(0, 200) : null;

export function analyzeDashboardExport(value) {
  const dashboard = value?.dashboard ?? value;
  if (!dashboard || !Array.isArray(dashboard.panels)) throw new GrafanaError('INVALID_DASHBOARD');
  const panels = [];
  function visit(items, depth = 0) {
    if (depth > 10) throw new GrafanaError('DASHBOARD_DEPTH_LIMIT');
    for (const panel of items) {
      if (!panel || typeof panel !== 'object' || panels.length >= 200) throw new GrafanaError('DASHBOARD_PANEL_LIMIT');
      const targets = panel.targets ?? [];
      if (!Array.isArray(targets) || targets.length > 20) throw new GrafanaError('DASHBOARD_TARGET_LIMIT');
      const active = targets.filter(target => target && target.hide !== true);
      const hasVariables = active.some(target => {
        const fields = ['expr', 'query', 'rawSql', 'rawQuery', 'metricQuery'].map(key => target[key]);
        return fields.concat(JSON.stringify(target.datasource ?? panel.datasource ?? '')).some(field => typeof field === 'string' && /\$[A-Za-z_{]/.test(field));
      });
      panels.push({ id: Number.isSafeInteger(panel.id) ? panel.id : null, title: safeText(panel.title), type: safeText(panel.type),
        activeQueries: active.length, hasDashboardVariables: hasVariables,
        hasTransformations: Array.isArray(panel.transformations) && panel.transformations.length > 0,
        hasThresholds: Array.isArray(panel.fieldConfig?.defaults?.thresholds?.steps) && panel.fieldConfig.defaults.thresholds.steps.length > 0 });
      if (Array.isArray(panel.panels)) visit(panel.panels, depth + 1);
    }
  }
  visit(dashboard.panels);
  const summary = summarySchema.parse({ uid: safeText(dashboard.uid), title: safeText(dashboard.title), panels });
  const candidates = panels.map(panel => {
    const blockers = [];
    if (!panel.activeQueries) blockers.push('No active query');
    if (panel.hasDashboardVariables) blockers.push('Dashboard variables require replacement');
    if (['row', 'text', 'dashlist', 'news'].includes(panel.type)) blockers.push('Panel does not represent an evaluable series');
    return { panelId: panel.id, title: panel.title, eligibleForDirectReuse: blockers.length === 0, blockers,
      warnings: [panel.hasTransformations && 'Review panel transformations', !panel.hasThresholds && 'Define an alert threshold', 'Validate query, evaluation window and No Data/Error behavior before creating an alert'].filter(Boolean) };
  });
  return { summary, ...candidatesSchema.parse({ candidates }) };
}
