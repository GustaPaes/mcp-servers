/**
 * Explicit safety and MCP annotation policy for every exported tool.
 * Keep this separate from handler discovery so an unclassified tool fails
 * startup instead of silently inheriting a mutating default.
 */
import {
  TOOL_RISK,
  annotationsForRisk,
  assertToolManifest,
} from "@gustapaes/mcp-runtime";

export const TOOL_POLICIES = Object.freeze({
  k8s_load_kubeconfig: policy("LOCAL_STATE", true, false),
  k8s_list_namespaces: policy("READ", true, true),
  k8s_list_pods: policy("READ", true, true),
  k8s_describe_pod: policy("READ", true, true),
  k8s_apply_manifest: policy("REMOTE_WRITE", true, true),
  k8s_delete_object: policy("DESTRUCTIVE", false, true),
  k8s_create_secret_from_vault: policy("REMOTE_WRITE", true, true),
  k8s_sync_vault_to_external_secrets: policy("REMOTE_WRITE", true, true),

  streaming_tail_oci_log: policy("READ", true, true),
  streaming_tail_pod_logs: policy("READ", true, true),

  fn_list_applications: policy("READ", true, true),
  fn_list_functions: policy("READ", true, true),
  fn_get_function: policy("READ", true, true),
  fn_create_application: policy("REMOTE_WRITE", false, true),
  fn_create_function: policy("REMOTE_WRITE", false, true),
  fn_invoke: policy("EXECUTION", false, true),
  fn_delete_function: policy("DESTRUCTIVE", false, true),

  vault_list: policy("READ", true, true),
  vault_get: policy("READ", true, true),
  vault_create: policy("REMOTE_WRITE", false, true),
  kms_key_list: policy("READ", true, true),
  kms_key_create: policy("REMOTE_WRITE", false, true),
  kms_key_rotate: policy("REMOTE_WRITE", false, true),
  kms_key_disable: policy("DESTRUCTIVE", false, true),
  secret_list: policy("READ", true, true),
  secret_get: policy("SECRET_READ", true, true),
  secret_create: policy("REMOTE_WRITE", false, true),
  secret_update_version: policy("REMOTE_WRITE", false, true),
  secret_schedule_deletion: policy("DESTRUCTIVE", false, true),
  secret_register_existing: policy("LOCAL_STATE", true, false),

  oke_list_clusters: policy("READ", true, true),
  oke_get_cluster: policy("READ", true, true),
  oke_list_node_pools: policy("READ", true, true),
  oke_get_node_pool: policy("READ", true, true),
  oke_list_addons: policy("READ", true, true),
  oke_get_work_request: policy("READ", true, true),
  oke_recommend_setup: policy("READ", true, false),
  oke_create_cluster: policy("REMOTE_WRITE", false, true),
  oke_track_create: policy("LOCAL_STATE", true, true),
  oke_create_node_pool: policy("REMOTE_WRITE", false, true),
  oke_scale_node_pool: policy("REMOTE_WRITE", true, true),
  oke_delete_cluster: policy("DESTRUCTIVE", false, true),
  oke_delete_node_pool: policy("DESTRUCTIVE", false, true),
  oke_get_kubeconfig: policy("SECRET_READ", true, true),
  oke_register_existing: policy("LOCAL_STATE", true, false),
  oke_list_owned: policy("READ", true, false),

  oci_whoami: policy("READ", true, true),
  oci_list_regions: policy("READ", true, true),
  oci_list_compartments: policy("READ", true, true),
  oci_list_availability_domains: policy("READ", true, true),
  oci_ledger_dump: policy("READ", true, false),
});

function policy(risk, idempotent, openWorld) {
  if (!Object.values(TOOL_RISK).includes(risk)) {
    throw new Error(`Unsupported tool risk: ${risk}`);
  }
  return Object.freeze({ risk, idempotent, openWorld });
}

export function annotationsFor(name) {
  const policy = TOOL_POLICIES[name];
  if (!policy) throw new Error(`Missing explicit tool safety classification: ${name}`);
  return annotationsForRisk(policy.risk, {
    title: name.replaceAll("_", " "),
    idempotent: policy.idempotent,
    openWorld: policy.openWorld,
  });
}

export function validateToolManifest(tools) {
  const definitions = Object.entries(tools).map(([name, definition]) => ({
    name,
    input: definition?.input,
  }));
  assertToolManifest({
    definitions,
    handlers: Object.fromEntries(
      Object.entries(tools).map(([name, definition]) => [name, definition?.handler])
    ),
    policies: TOOL_POLICIES,
    label: "oci-extras-mcp",
  });
  const invalid = definitions.filter((definition) => !definition.input).map(({ name }) => name);
  if (invalid.length) throw new Error(`Tools without input schema: ${invalid.join(", ")}`);
}
