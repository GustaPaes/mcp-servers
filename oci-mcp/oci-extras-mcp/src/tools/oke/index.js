/**
 * OKE (Container Engine for Kubernetes) tools.
 *
 * All tools follow the safety contract:
 *   - read-only: no guards needed
 *   - write/destructive: guardMutation() checked first
 *   - resources created here are recorded in the ownership ledger
 */
import { z } from "zod";
import { containerEngineClient, workRequestClient } from "../../lib/ociClient.js";
import { paginateAll } from "../../lib/pagination.js";
import { withRetry } from "../../lib/retries.js";
import { config } from "../../config.js";
import {
  CompartmentOcid,
  ClusterOcid,
  NodePoolOcid,
  Ocid,
  SafetyInputs,
  FreeformTags,
  DefinedTags,
  MCP_OWNER_TAG,
} from "../../schemas.js";
import {
  guardMutation,
  effectiveDryRun,
  buildDryRunPlan,
} from "../../safety/guards.js";
import * as ownership from "../../safety/ownership.js";

const compartmentField = (z) =>
  CompartmentOcid.default(config.defaultCompartmentOcid ?? undefined);

// --------------------------------------------------------------------------
// READ TOOLS
// --------------------------------------------------------------------------

export const oke_list_clusters = {
  description:
    "List OKE clusters in a compartment. Returns id, name, vcnId, kubernetesVersion, lifecycleState.",
  input: z.object({
    compartmentId: compartmentField(z),
    name: z.string().optional(),
    state: z.string().optional().describe("Filter by lifecycleState (e.g. ACTIVE)"),
    max: z.number().int().positive().max(1000).default(100),
  }),
  async handler({ compartmentId, name, state, max }) {
    const ce = await containerEngineClient();
    const items = await paginateAll(
      (params) => ce.listClusters({ compartmentId, name, lifecycleState: state, ...params }),
      {},
      { max }
    );
    return {
      count: items.length,
      clusters: items.map((c) => ({
        id: c.id,
        name: c.name,
        vcnId: c.vcnId,
        kubernetesVersion: c.kubernetesVersion,
        lifecycleState: c.lifecycleState,
        type: c.type,
        endpointConfig: c.endpointConfig,
        privateEndpoint: c.endpoints?.privateEndpoint,
        publicEndpoint: c.endpoints?.publicEndpoint,
      })),
    };
  },
};

export const oke_get_cluster = {
  description: "Get full details of an OKE cluster by OCID.",
  input: z.object({ id: ClusterOcid }),
  async handler({ id }) {
    const ce = await containerEngineClient();
    const res = await withRetry(() => ce.getCluster({ clusterId: id }));
    return res.cluster;
  },
};

export const oke_list_node_pools = {
  description: "List node pools, optionally filtered by cluster.",
  input: z.object({
    compartmentId: compartmentField(z),
    clusterId: ClusterOcid.optional(),
    max: z.number().int().positive().max(1000).default(100),
  }),
  async handler({ compartmentId, clusterId, max }) {
    const ce = await containerEngineClient();
    const items = await paginateAll(
      (params) => ce.listNodePools({ compartmentId, clusterId, ...params }),
      {},
      { max }
    );
    return {
      count: items.length,
      nodePools: items.map((p) => ({
        id: p.id,
        name: p.name,
        clusterId: p.clusterId,
        nodeShape: p.nodeShape,
        nodeImageName: p.nodeImageName,
        kubernetesVersion: p.kubernetesVersion,
        size: p.nodeConfigDetails?.size ?? p.quantityPerSubnet,
      })),
    };
  },
};

export const oke_get_node_pool = {
  description: "Get full details of a node pool by OCID.",
  input: z.object({ id: NodePoolOcid }),
  async handler({ id }) {
    const ce = await containerEngineClient();
    const res = await withRetry(() => ce.getNodePool({ nodePoolId: id }));
    return res.nodePool;
  },
};

export const oke_list_addons = {
  description: "List installed/available add-ons for a cluster.",
  input: z.object({ clusterId: ClusterOcid }),
  async handler({ clusterId }) {
    const ce = await containerEngineClient();
    const items = await paginateAll((params) => ce.listAddons({ clusterId, ...params }));
    return { count: items.length, addons: items };
  },
};

export const oke_get_work_request = {
  description: "Track an OKE async operation (cluster create/update, node pool ops).",
  input: z.object({ workRequestId: Ocid }),
  async handler({ workRequestId }) {
    const wr = await workRequestClient();
    const res = await wr.getWorkRequest({ workRequestId });
    return res.workRequest;
  },
};

export const oke_recommend_setup = {
  description:
    "Returns an opinionated production-ready checklist & recommended values for creating an OKE cluster.",
  input: z.object({
    purpose: z
      .enum(["dev", "staging", "production"])
      .default("production")
      .describe("Target environment — affects recommendations"),
  }),
  async handler({ purpose }) {
    return {
      checklist: [
        "Use ENHANCED_CLUSTER (required for add-ons, virtual nodes, workload identity)",
        "Set a PRIVATE API endpoint + use bastion or OCI Service Operator",
        "Enable Image Policy add-on with cosign-signed images from OCIR",
        "Configure Pod Security Admission to 'restricted' on app namespaces",
        "Enable Network Policy add-on (Cilium)",
        "Enable Cluster Autoscaler with at least 2 node pool shapes",
        "Use Workload Identity (no static credentials in pods)",
        "Encrypt etcd & boot volumes with KMS-managed key",
        "Send control-plane + audit logs to OCI Logging",
        "Schedule Velero backups to Object Storage",
        "Tag every resource: Project, Environment, Owner, CostCenter",
      ],
      recommendedClusterPayload: {
        type: "ENHANCED_CLUSTER",
        kubernetesVersion: "v1.30.1",
        options: {
          serviceLbSubnetIds: ["<replace>"],
          addOns: { isKubernetesDashboardEnabled: false },
          admissionControllerOptions: { isPodSecurityPolicyEnabled: false },
          persistentVolumeConfig: {},
        },
        endpointConfig: { isPublicIpEnabled: purpose !== "production", subnetId: "<replace>" },
      },
      recommendedAddons: [
        "CertManager",
        "ClusterAutoscaler",
        "OracleDatabaseOperator",
        "WebLogicKubernetesOperator",
        "MetricsServer",
        "NativeIngressController",
      ],
      hardeningTips: [
        "audit-policy: enable explicit logging of all secrets access",
        "OCI Vault for application secrets — sync via External Secrets Operator",
        "Restrict kubeconfig distribution; prefer OIDC/Workload Identity",
      ],
    };
  },
};

// --------------------------------------------------------------------------
// WRITE TOOLS — create
// --------------------------------------------------------------------------

export const oke_create_cluster = {
  description:
    "Create a new OKE cluster. Defaults to ENHANCED_CLUSTER. Resource is recorded in the ownership ledger.",
  input: z.object({
    name: z.string().min(1),
    compartmentId: compartmentField(z),
    vcnId: Ocid,
    kubernetesVersion: z.string().describe("e.g. v1.30.1"),
    type: z.enum(["BASIC_CLUSTER", "ENHANCED_CLUSTER"]).default("ENHANCED_CLUSTER"),
    endpointSubnetId: Ocid,
    isPublicIpEnabled: z.boolean().default(false),
    serviceLbSubnetIds: z.array(Ocid).optional(),
    kmsKeyId: Ocid.optional().describe("KMS key for etcd encryption (recommended for production)"),
    freeformTags: FreeformTags,
    definedTags: DefinedTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const ce = await containerEngineClient();

    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "oke_cluster",
    });
    if (!guard.ok) return guard;

    const payload = {
      name: input.name,
      compartmentId: input.compartmentId,
      vcnId: input.vcnId,
      kubernetesVersion: input.kubernetesVersion,
      type: input.type,
      endpointConfig: {
        subnetId: input.endpointSubnetId,
        isPublicIpEnabled: input.isPublicIpEnabled,
      },
      kmsKeyId: input.kmsKeyId,
      options: input.serviceLbSubnetIds
        ? { serviceLbSubnetIds: input.serviceLbSubnetIds }
        : undefined,
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
      definedTags: input.definedTags,
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "oke_cluster",
        target: input.name,
        payload,
      });
    }

    const res = await withRetry(() =>
      ce.createCluster({ createClusterDetails: payload })
    );
    const workRequestId = res.opcWorkRequestId;
    return {
      ok: true,
      workRequestId,
      message:
        `Cluster creation started. Track with oke_get_work_request({ workRequestId: "${workRequestId}" }).`,
      note:
        "OCID will be populated in the ownership ledger once you call oke_register_existing or once we observe the WorkRequest completion via oke_track_create.",
    };
  },
};

export const oke_track_create = {
  description:
    "Poll an OKE create WorkRequest until completion and register the resulting OCID in the ownership ledger.",
  input: z.object({
    workRequestId: Ocid,
    timeoutSeconds: z.number().int().positive().default(900),
    resourceTypeHint: z.enum(["oke_cluster", "oke_node_pool"]).default("oke_cluster"),
  }),
  async handler({ workRequestId, timeoutSeconds, resourceTypeHint }) {
    const wr = await workRequestClient();
    const deadline = Date.now() + timeoutSeconds * 1000;
    let last;
    while (Date.now() < deadline) {
      const r = await wr.getWorkRequest({ workRequestId });
      last = r.workRequest;
      if (last.status === "SUCCEEDED" || last.status === "FAILED" || last.status === "CANCELED") break;
      await new Promise((res) => setTimeout(res, 5000));
    }
    if (last?.status !== "SUCCEEDED") {
      return { ok: false, status: last?.status, workRequest: last };
    }
    const created = (last.resources ?? []).find(
      (r) => r.actionType === "CREATED" || r.actionType === "Created"
    );
    if (created?.identifier) {
      ownership.record({
        ocid: created.identifier,
        type: resourceTypeHint,
        name: created.entityType ?? "(unknown)",
        compartment: config.defaultCompartmentOcid,
      });
    }
    return { ok: true, status: last.status, createdOcid: created?.identifier };
  },
};

export const oke_create_node_pool = {
  description: "Create a node pool inside an existing OKE cluster.",
  input: z.object({
    name: z.string().min(1),
    compartmentId: compartmentField(z),
    clusterId: ClusterOcid,
    kubernetesVersion: z.string(),
    nodeShape: z.string().describe("e.g. VM.Standard.E4.Flex"),
    nodeShapeOcpus: z.number().positive().optional(),
    nodeShapeMemoryGBs: z.number().positive().optional(),
    nodeImageId: Ocid,
    placementConfigs: z
      .array(
        z.object({
          availabilityDomain: z.string(),
          subnetId: Ocid,
          capacityReservationId: Ocid.optional(),
        })
      )
      .min(1),
    size: z.number().int().min(0).default(3),
    nodeMetadata: z.record(z.string(), z.string()).optional(),
    sshPublicKey: z.string().optional(),
    freeformTags: FreeformTags,
    definedTags: DefinedTags,
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const ce = await containerEngineClient();

    const guard = guardMutation({
      input,
      action: "create",
      name: input.name,
      resourceType: "oke_node_pool",
    });
    if (!guard.ok) return guard;

    const payload = {
      name: input.name,
      compartmentId: input.compartmentId,
      clusterId: input.clusterId,
      kubernetesVersion: input.kubernetesVersion,
      nodeShape: input.nodeShape,
      nodeShapeConfig:
        input.nodeShapeOcpus || input.nodeShapeMemoryGBs
          ? { ocpus: input.nodeShapeOcpus, memoryInGBs: input.nodeShapeMemoryGBs }
          : undefined,
      nodeSourceDetails: {
        sourceType: "IMAGE",
        imageId: input.nodeImageId,
      },
      nodeConfigDetails: {
        size: input.size,
        placementConfigs: input.placementConfigs,
      },
      nodeMetadata: {
        ...(input.nodeMetadata ?? {}),
        ...(input.sshPublicKey ? { ssh_authorized_keys: input.sshPublicKey } : {}),
      },
      freeformTags: { ...MCP_OWNER_TAG, ...(input.freeformTags ?? {}) },
      definedTags: input.definedTags,
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "create",
        resourceType: "oke_node_pool",
        target: input.name,
        payload,
      });
    }

    const res = await withRetry(() => ce.createNodePool({ createNodePoolDetails: payload }));
    return {
      ok: true,
      workRequestId: res.opcWorkRequestId,
      message: `Node pool creation started. Track with oke_get_work_request.`,
    };
  },
};

// --------------------------------------------------------------------------
// WRITE TOOLS — update
// --------------------------------------------------------------------------

export const oke_scale_node_pool = {
  description: "Scale a node pool to the given size.",
  input: z.object({
    id: NodePoolOcid,
    size: z.number().int().min(0),
    ...SafetyInputs.shape,
  }),
  async handler(input) {
    const ce = await containerEngineClient();
    const current = await ce.getNodePool({ nodePoolId: input.id });
    const name = current.nodePool?.name;

    const guard = guardMutation({
      input,
      action: "update",
      ocid: input.id,
      name,
      resourceType: "oke_node_pool",
    });
    if (!guard.ok) return guard;

    const payload = {
      nodeConfigDetails: {
        size: input.size,
        placementConfigs: current.nodePool.nodeConfigDetails?.placementConfigs,
      },
    };

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "scale",
        resourceType: "oke_node_pool",
        target: name,
        payload: { ...payload, currentSize: current.nodePool.nodeConfigDetails?.size },
      });
    }

    const res = await ce.updateNodePool({
      nodePoolId: input.id,
      updateNodePoolDetails: payload,
    });
    return { ok: true, workRequestId: res.opcWorkRequestId };
  },
};

// --------------------------------------------------------------------------
// DESTRUCTIVE TOOLS — delete
// --------------------------------------------------------------------------

export const oke_delete_cluster = {
  description:
    "DELETE an OKE cluster. Requires OCI_MCP_ALLOW_DESTRUCTIVE=true and explicit confirm. " +
    "Third-party (non-MCP-created) clusters additionally require humanAck round-trip.",
  input: z.object({ id: ClusterOcid, ...SafetyInputs.shape }),
  async handler(input) {
    const ce = await containerEngineClient();
    let name = null;
    try {
      const r = await ce.getCluster({ clusterId: input.id });
      name = r.cluster?.name;
    } catch {
      /* if get fails, name stays null */
    }

    const guard = guardMutation({
      input,
      action: "delete",
      ocid: input.id,
      name,
      resourceType: "oke_cluster",
      destructive: true,
    });
    if (!guard.ok) return guard;

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "delete",
        resourceType: "oke_cluster",
        target: name ?? input.id,
        payload: { id: input.id },
      });
    }

    const res = await ce.deleteCluster({ clusterId: input.id });
    ownership.remove(input.id);
    return { ok: true, workRequestId: res.opcWorkRequestId };
  },
};

export const oke_delete_node_pool = {
  description: "DELETE a node pool. Same safety rules as oke_delete_cluster.",
  input: z.object({ id: NodePoolOcid, ...SafetyInputs.shape }),
  async handler(input) {
    const ce = await containerEngineClient();
    let name = null;
    try {
      const r = await ce.getNodePool({ nodePoolId: input.id });
      name = r.nodePool?.name;
    } catch {
      /* ignore */
    }

    const guard = guardMutation({
      input,
      action: "delete",
      ocid: input.id,
      name,
      resourceType: "oke_node_pool",
      destructive: true,
    });
    if (!guard.ok) return guard;

    if (effectiveDryRun(input)) {
      return buildDryRunPlan({
        action: "delete",
        resourceType: "oke_node_pool",
        target: name ?? input.id,
        payload: { id: input.id },
      });
    }

    const res = await ce.deleteNodePool({ nodePoolId: input.id });
    ownership.remove(input.id);
    return { ok: true, workRequestId: res.opcWorkRequestId };
  },
};

// --------------------------------------------------------------------------
// KUBECONFIG
// --------------------------------------------------------------------------

export const oke_get_kubeconfig = {
  description:
    "Download the kubeconfig for an OKE cluster. Returns the YAML content (not written to disk by default).",
  input: z.object({
    clusterId: ClusterOcid,
    tokenVersion: z.enum(["1.0.0", "2.0.0"]).default("2.0.0"),
    expirationSeconds: z.number().int().positive().max(86400).default(3600),
    endpoint: z.enum(["PUBLIC_ENDPOINT", "PRIVATE_ENDPOINT"]).default("PUBLIC_ENDPOINT"),
  }),
  async handler({ clusterId, tokenVersion, expirationSeconds, endpoint }) {
    const ce = await containerEngineClient();
    const res = await ce.createKubeconfig({
      clusterId,
      createClusterKubeconfigContentDetails: {
        tokenVersion,
        expiration: expirationSeconds,
        endpoint,
      },
    });
    // Response value is a stream — read it
    const chunks = [];
    for await (const c of res.value) chunks.push(c);
    const yaml = Buffer.concat(chunks).toString("utf-8");
    return {
      kubeconfig: yaml,
      note:
        "To apply locally: write to a file and set KUBECONFIG, or use k8s_load_kubeconfig tool to merge.",
    };
  },
};

// --------------------------------------------------------------------------
// REGISTER existing (so MCP can manage pre-existing infra explicitly)
// --------------------------------------------------------------------------

export const oke_register_existing = {
  description:
    "Add an EXISTING cluster or node pool to the ownership ledger so subsequent edits/deletes don't require third-party humanAck. Use only after explicit user authorisation.",
  input: z.object({
    ocid: Ocid,
    type: z.enum(["oke_cluster", "oke_node_pool"]),
    confirm: z.string().describe("Must equal the OCID exactly to acknowledge intent."),
  }),
  async handler({ ocid, type, confirm }) {
    if (confirm !== ocid) {
      return { ok: false, error: "confirm must equal the OCID exactly." };
    }
    const ce = await containerEngineClient();
    let name = "(unknown)";
    let compartment = null;
    try {
      if (type === "oke_cluster") {
        const r = await ce.getCluster({ clusterId: ocid });
        name = r.cluster.name;
        compartment = r.cluster.compartmentId;
      } else {
        const r = await ce.getNodePool({ nodePoolId: ocid });
        name = r.nodePool.name;
        compartment = r.nodePool.compartmentId;
      }
    } catch {
      /* allow registering even if read fails */
    }
    ownership.record({ ocid, type, name, compartment, extra: { adoptedAt: new Date().toISOString() } });
    return { ok: true, message: `Registered ${type} '${name}' in ownership ledger.` };
  },
};

export const oke_list_owned = {
  description: "List OKE resources currently tracked in the ownership ledger.",
  input: z.object({
    type: z.enum(["oke_cluster", "oke_node_pool"]).optional(),
  }),
  async handler({ type }) {
    return { items: ownership.list({ type }) };
  },
};
