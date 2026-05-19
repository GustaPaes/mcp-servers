/**
 * Kubernetes layer — operates on whatever cluster the active kubeconfig points to.
 * Designed to compose with OKE: get a kubeconfig from oke_get_kubeconfig, load it
 * via k8s_load_kubeconfig, then use the rest of these tools.
 *
 * Includes the flagship integration: k8s_create_secret_from_vault and
 * k8s_sync_vault_to_external_secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import yaml from "js-yaml";
import * as k8s from "@kubernetes/client-node";

import { config } from "../../config.js";
import { secretsClient } from "../../lib/ociClient.js";
import { SecretOcid, SafetyInputs } from "../../schemas.js";
import {
  guardMutation,
  effectiveDryRun,
  buildDryRunPlan,
} from "../../safety/guards.js";
import * as ownership from "../../safety/ownership.js";

// ---------------------------------------------------------------------------
// Kubeconfig loader
// ---------------------------------------------------------------------------

let activeKc = null;

function getKc() {
  if (activeKc) return activeKc;
  const kc = new k8s.KubeConfig();
  if (fs.existsSync(config.kubeconfigPath)) {
    kc.loadFromFile(config.kubeconfigPath);
  } else {
    try {
      kc.loadFromDefault();
    } catch {
      throw new Error(
        `No kubeconfig found at ${config.kubeconfigPath}. Use k8s_load_kubeconfig with raw YAML, ` +
          `or call oke_get_kubeconfig and save the result first.`
      );
    }
  }
  activeKc = kc;
  return kc;
}

export const k8s_load_kubeconfig = {
  description:
    "Load a kubeconfig YAML into the active session. Optionally merge into KUBECONFIG file on disk.",
  input: z.object({
    yaml: z.string().describe("kubeconfig YAML content"),
    persist: z.boolean().default(false).describe("If true, write to KUBECONFIG path"),
    merge: z.boolean().default(true).describe("If persist:true, merge with existing kubeconfig"),
  }),
  async handler({ yaml: yamlText, persist, merge }) {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(yamlText);
    activeKc = kc;

    if (persist) {
      const target = config.kubeconfigPath;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (merge && fs.existsSync(target)) {
        const existing = yaml.load(fs.readFileSync(target, "utf-8"));
        const incoming = yaml.load(yamlText);
        const merged = mergeKubeconfigs(existing, incoming);
        fs.writeFileSync(target, yaml.dump(merged));
      } else {
        fs.writeFileSync(target, yamlText);
      }
    }
    return {
      ok: true,
      currentContext: kc.getCurrentContext(),
      contexts: kc.getContexts().map((c) => c.name),
      persisted: persist,
    };
  },
};

function mergeKubeconfigs(a, b) {
  const merge = (key, by = "name") => {
    const map = new Map();
    for (const it of a?.[key] ?? []) map.set(it[by], it);
    for (const it of b?.[key] ?? []) map.set(it[by], it);
    return [...map.values()];
  };
  return {
    apiVersion: b.apiVersion ?? a.apiVersion ?? "v1",
    kind: "Config",
    clusters: merge("clusters"),
    contexts: merge("contexts"),
    users: merge("users"),
    "current-context": b["current-context"] ?? a["current-context"],
  };
}

// ---------------------------------------------------------------------------
// READ tools
// ---------------------------------------------------------------------------

export const k8s_list_namespaces = {
  description: "List Kubernetes namespaces in the active context.",
  input: z.object({}),
  async handler() {
    const api = getKc().makeApiClient(k8s.CoreV1Api);
    const res = await api.listNamespace();
    return {
      namespaces: res.items.map((n) => ({
        name: n.metadata.name,
        status: n.status?.phase,
        labels: n.metadata.labels,
        createdAt: n.metadata.creationTimestamp,
      })),
    };
  },
};

export const k8s_list_pods = {
  description: "List pods in a namespace.",
  input: z.object({
    namespace: z.string().default("default"),
    labelSelector: z.string().optional(),
  }),
  async handler({ namespace, labelSelector }) {
    const api = getKc().makeApiClient(k8s.CoreV1Api);
    const res = await api.listNamespacedPod({ namespace, labelSelector });
    return {
      count: res.items.length,
      pods: res.items.map((p) => ({
        name: p.metadata.name,
        status: p.status.phase,
        node: p.spec.nodeName,
        containers: p.spec.containers.map((c) => c.name),
        restarts: p.status.containerStatuses?.[0]?.restartCount ?? 0,
        createdAt: p.metadata.creationTimestamp,
      })),
    };
  },
};

export const k8s_describe_pod = {
  description: "Describe a single pod (full JSON).",
  input: z.object({ namespace: z.string().default("default"), name: z.string() }),
  async handler({ namespace, name }) {
    const api = getKc().makeApiClient(k8s.CoreV1Api);
    const res = await api.readNamespacedPod({ name, namespace });
    return res;
  },
};

// ---------------------------------------------------------------------------
// WRITE tools
// ---------------------------------------------------------------------------

export const k8s_apply_manifest = {
  description:
    "Apply a Kubernetes manifest (YAML). Multi-document supported. Resources created here are tracked. " +
    "Editing/deleting pre-existing K8s objects requires confirm + humanAck.",
  input: z.object({
    yaml: z.string().describe("Kubernetes YAML manifest (one or many documents)"),
    namespace: z.string().optional().describe("Override namespace metadata"),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const docs = yaml.loadAll(input.yaml).filter(Boolean);

    // Track if any of the docs target an existing resource (we treat that as update/third-party)
    const k8sApi = k8s.KubernetesObjectApi.makeApiClient(getKc());
    const planned = [];

    for (const doc of docs) {
      if (input.namespace) doc.metadata = { ...doc.metadata, namespace: input.namespace };
      let exists = false;
      let existingUid = null;
      try {
        const existing = await k8sApi.read(doc);
        exists = true;
        existingUid = existing.metadata?.uid;
      } catch {
        exists = false;
      }
      const ledgerKey = existingUid ? `k8s://${existingUid}` : null;
      const ownedByMcp = ledgerKey ? ownership.isOwned(ledgerKey) : false;

      if (exists && !ownedByMcp) {
        // Third-party update
        const guard = guardMutation({
          input,
          action: "update",
          ocid: ledgerKey,
          name: `${doc.kind}/${doc.metadata?.name}`,
          resourceType: `k8s_${doc.kind?.toLowerCase()}`,
        });
        if (!guard.ok) return guard;
      }
      planned.push({ doc, exists, ownedByMcp, ledgerKey });
    }

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "apply",
        resourceType: "k8s_manifest",
        target: `${planned.length} object(s)`,
        payload: planned.map((p) => ({
          kind: p.doc.kind,
          name: p.doc.metadata?.name,
          namespace: p.doc.metadata?.namespace,
          willAction: p.exists ? "update" : "create",
        })),
      });
    }

    const results = [];
    for (const p of planned) {
      let res;
      if (p.exists) {
        res = await k8sApi.replace(p.doc);
      } else {
        res = await k8sApi.create(p.doc);
        const uid = res.metadata?.uid;
        if (uid) {
          ownership.record({
            ocid: `k8s://${uid}`,
            type: `k8s_${p.doc.kind?.toLowerCase()}`,
            name: `${p.doc.kind}/${p.doc.metadata?.name}`,
            compartment: null,
            extra: { namespace: p.doc.metadata?.namespace },
          });
        }
      }
      results.push({
        kind: p.doc.kind,
        name: p.doc.metadata?.name,
        namespace: p.doc.metadata?.namespace,
        action: p.exists ? "updated" : "created",
        uid: res.metadata?.uid,
      });
    }
    return { ok: true, results };
  },
};

export const k8s_delete_object = {
  description: "Delete a Kubernetes object. Destructive; requires confirm.",
  input: z.object({
    kind: z.string(),
    apiVersion: z.string(),
    name: z.string(),
    namespace: z.string().optional(),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const k8sApi = k8s.KubernetesObjectApi.makeApiClient(getKc());
    const obj = {
      apiVersion: input.apiVersion,
      kind: input.kind,
      metadata: { name: input.name, namespace: input.namespace },
    };
    let uid = null;
    try {
      const existing = await k8sApi.read(obj);
      uid = existing.metadata?.uid;
    } catch (e) {
      return { ok: false, error: `Not found: ${input.kind}/${input.name}` };
    }
    const ledgerKey = uid ? `k8s://${uid}` : null;
    const guard = guardMutation({
      input,
      action: "delete",
      ocid: ledgerKey,
      name: `${input.kind}/${input.name}`,
      resourceType: `k8s_${input.kind.toLowerCase()}`,
      destructive: true,
    });
    if (!guard.ok) return guard;

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "delete",
        resourceType: `k8s_${input.kind.toLowerCase()}`,
        target: `${input.kind}/${input.name}`,
        payload: { uid },
      });
    }

    await k8sApi.delete(obj);
    if (ledgerKey) ownership.remove(ledgerKey);
    return { ok: true };
  },
};

// ---------------------------------------------------------------------------
// VAULT → K8s SECRET integration (flagship workflow)
// ---------------------------------------------------------------------------

export const k8s_create_secret_from_vault = {
  description:
    "Read an OCI Vault secret and create/update a Kubernetes Secret in the cluster. " +
    "Use only for bootstrapping; for production prefer k8s_sync_vault_to_external_secrets.",
  input: z.object({
    ociSecretId: SecretOcid,
    namespace: z.string().default("default"),
    secretName: z.string(),
    keyInsideSecret: z.string().default("value"),
    type: z.string().default("Opaque"),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const sc = await secretsClient();
    const bundle = await sc.getSecretBundle({ secretId: input.ociSecretId });
    const content = bundle.secretBundle?.secretBundleContent;
    const raw =
      content?.contentType === "BASE64"
        ? Buffer.from(content.content, "base64").toString("utf-8")
        : content?.content;

    const api = getKc().makeApiClient(k8s.CoreV1Api);
    let exists = false;
    let uid = null;
    try {
      const cur = await api.readNamespacedSecret({
        name: input.secretName,
        namespace: input.namespace,
      });
      exists = true;
      uid = cur.metadata?.uid;
    } catch {
      exists = false;
    }

    const ledgerKey = uid ? `k8s://${uid}` : null;
    const guard = guardMutation({
      input,
      action: exists ? "update" : "create",
      ocid: ledgerKey,
      name: `Secret/${input.secretName}`,
      resourceType: "k8s_secret",
    });
    if (!guard.ok) return guard;

    const body = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: input.secretName,
        namespace: input.namespace,
        labels: { "managed-by": "oci-extras-mcp" },
        annotations: { "oci-extras-mcp/source-secret-id": input.ociSecretId },
      },
      type: input.type,
      data: { [input.keyInsideSecret]: Buffer.from(raw, "utf-8").toString("base64") },
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: exists ? "update" : "create",
        resourceType: "k8s_secret",
        target: `${input.namespace}/${input.secretName}`,
        payload: { ...body, data: "***REDACTED***" },
      });
    }

    let res;
    if (exists) {
      res = await api.replaceNamespacedSecret({
        name: input.secretName,
        namespace: input.namespace,
        body,
      });
    } else {
      res = await api.createNamespacedSecret({ namespace: input.namespace, body });
      const newUid = res.metadata?.uid;
      if (newUid) {
        ownership.record({
          ocid: `k8s://${newUid}`,
          type: "k8s_secret",
          name: `Secret/${input.secretName}`,
          compartment: null,
          extra: { namespace: input.namespace, sourceOciSecret: input.ociSecretId },
        });
      }
    }
    return { ok: true, action: exists ? "updated" : "created" };
  },
};

export const k8s_sync_vault_to_external_secrets = {
  description:
    "Generate an ExternalSecret CR (External Secrets Operator) that pulls from OCI Vault. " +
    "Recommended for production; secrets refresh automatically.",
  input: z.object({
    ociSecretId: SecretOcid,
    namespace: z.string().default("default"),
    externalSecretName: z.string(),
    targetSecretName: z.string(),
    refreshInterval: z.string().default("1h"),
    secretStoreRef: z.string().describe("Name of the OCIVault SecretStore CR"),
    keyInsideSecret: z.string().default("value"),
    apply: z.boolean().default(false).describe("If true, apply via k8s_apply_manifest internally"),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const manifest = {
      apiVersion: "external-secrets.io/v1beta1",
      kind: "ExternalSecret",
      metadata: {
        name: input.externalSecretName,
        namespace: input.namespace,
        labels: { "managed-by": "oci-extras-mcp" },
      },
      spec: {
        refreshInterval: input.refreshInterval,
        secretStoreRef: { name: input.secretStoreRef, kind: "SecretStore" },
        target: { name: input.targetSecretName, creationPolicy: "Owner" },
        data: [
          {
            secretKey: input.keyInsideSecret,
            remoteRef: { key: input.ociSecretId },
          },
        ],
      },
    };
    const yamlOut = yaml.dump(manifest);
    if (!input.apply) return { manifest, yaml: yamlOut, applied: false };
    return await k8s_apply_manifest.handler({
      yaml: yamlOut,
      dryRun: input.dryRun,
      confirm: input.confirm,
      humanAck: input.humanAck,
    });
  },
};
