import { z } from "zod";
import { getConfigurationSummary, getSavedQueryNames } from "../config.js";
import { checkTfsConnectivity } from "../tfs-client.js";

export async function toolTfsDoctor(args) {
  const { check_connectivity } = z.strictObject({
    check_connectivity: z.boolean().default(false),
  }).parse(args);
  const configuration = getConfigurationSummary();
  const issues = [];
  if (!configuration.endpointConfigured) issues.push("Configure TFS_URL ou connection.url.");
  if (!configuration.collectionConfigured) issues.push("Configure TFS_COLLECTION ou connection.collection.");
  if (!configuration.projectConfigured) issues.push("Configure TFS_PROJECT ou connection.project.");
  if (
    !configuration.auth.defaultPatConfigured
    && configuration.auth.aliases.length === 0
  ) {
    issues.push("Configure TFS_PAT ou ao menos um TFS_PAT_<ALIAS>.");
  }

  const connectivity = check_connectivity
    ? await checkTfsConnectivity()
    : { checked: false };
  return {
    ok: issues.length === 0 && (!check_connectivity || connectivity.ok === true),
    configuration,
    connectivity,
    issues,
  };
}

export function toolSavedQueriesList() {
  const names = getSavedQueryNames();
  return {
    count: names.length,
    names,
  };
}
