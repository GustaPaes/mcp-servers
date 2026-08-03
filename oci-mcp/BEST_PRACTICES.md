# Best Practices — oci-mcp

This document collects opinionated, production-grade practices for using **oci-mcp** with LLM agents against Oracle Cloud Infrastructure. It is meant to be read **once by humans** and **always referenced by your LLM system prompt**.

---

## 1. Identity & Access Management (IAM)

### 1.1 Use a dedicated MCP user / dynamic group
Never use the tenancy administrator credentials. Create:

- **For human dev**: an IAM user `mcp-operator` in a dedicated `mcp-operators` group.
- **For server / CI**: a **Dynamic Group** matching the host (`instance.compartment.id = '<...>'`) with **Resource Principal** auth.

### 1.2 Least-privilege baseline policies

```text
# Read-everywhere baseline (all tools)
allow group mcp-operators to inspect all-resources in compartment <Compartment>

# OKE management
allow group mcp-operators to manage cluster-family in compartment <Compartment>
allow group mcp-operators to use virtual-network-family in compartment <Compartment>
allow group mcp-operators to manage instance-family in compartment <Compartment>

# Vault & Secrets
allow group mcp-operators to manage vaults in compartment <Compartment>
allow group mcp-operators to manage keys in compartment <Compartment>
allow group mcp-operators to manage secret-family in compartment <Compartment>

# Functions
allow group mcp-operators to manage functions-family in compartment <Compartment>

# Logging (read for streaming)
allow group mcp-operators to read log-content in compartment <Compartment>
```

Tighten further by scoping `where` conditions on `target.resource.tag` (e.g. `target.resource.tag.Project.Owner='mcp'`).

### 1.3 Separate compartments per environment
`prod`, `staging`, `sandbox` — each with **its own MCP profile** (`OCI_CONFIG_PROFILE=prod-readonly`, `OCI_CONFIG_PROFILE=sandbox-write`).

---

## 2. Authentication

| Scenario | Recommended method |
|---|---|
| Developer on Windows / Mac | **Session Token** (`oci session authenticate`) |
| CI/CD pipeline outside OCI | **API Key** (rotated, in vault) |
| MCP server inside an OCI VM | **Instance Principal** |
| MCP server inside Functions / OKE | **Resource Principal** |

The custom server auto-detects in this order: explicit `OCI_AUTH_METHOD` → `resource_principal` env vars → `instance_principal` (if metadata endpoint reachable) → session/api key from `~/.oci/config`.

**Never** hardcode private keys. Use `key_file=~/.oci/oci_api_key.pem` (with `~`) so containers resolve it correctly.

---

## 3. Safety Guards (built into oci-extras-mcp)

### 3.1 The ownership ledger
Every resource created via `oci-extras-mcp` is recorded in `.ownership-ledger.json`:

```json
{
  "ocid1.cluster.oc1...": {
    "type": "oke_cluster",
    "name": "prod-app",
    "createdBy": "oci-extras-mcp",
    "createdAt": "2026-04-30T17:00:00Z",
    "compartment": "ocid1.compartment.oc1...",
    "tags": { "Owner": "mcp" }
  }
}
```

When the LLM tries to **edit or delete** a resource:

- ✅ **In ledger** → proceed (still respecting destructive flag).
- ⚠️ **NOT in ledger** → tool refuses unless:
  1. `OCI_MCP_ALLOW_THIRD_PARTY_MUTATION=true`, **and**
  2. Input contains `confirm: "<exact-name-or-ocid>"`, **and**
  3. The tool returns a `requiresHumanAck` payload first; the LLM must show it to the user and re-call with `humanAck:true`.

This prevents catastrophic deletions of resources that pre-existed your MCP session.

### 3.2 Dry-run by default
`OCI_MCP_DEFAULT_DRY_RUN=true` makes every write tool simulate first. The response includes the diff/plan; you must explicitly call again with `dryRun:false`.

### 3.3 Destructive operations
`delete_*`, `terminate_*`, `schedule_deletion_*` always require:
- `OCI_MCP_ALLOW_DESTRUCTIVE=true`
- `confirm: "<resource-identifier>"` matching exactly

### 3.4 Secrets
Default returns `value: "***REDACTED***"` and exposes only metadata (id, name, version, createdAt). Reveal requires `OCI_MCP_ALLOW_SECRET_REVEAL=true` + `reveal:true`.

---

## 4. OKE (Kubernetes Engine) — production checklist

- [ ] **Enhanced clusters** for production (allows add-ons, virtual nodes, workload identity).
- [ ] **Private API endpoint** + bastion or OCI Service Operator for kubectl access.
- [ ] **Image policy add-on** with signed images (cosign) from OCIR.
- [ ] **Pod Security Admission** at `restricted` for non-system namespaces.
- [ ] **Network Policy** add-on (Cilium) enabled.
- [ ] **Cluster autoscaler** + multiple node-pool shapes (general + memory-optimized).
- [ ] **Workload Identity** to map K8s service accounts → OCI principals (no static credentials in pods).
- [ ] **Encryption at rest** with **KMS-managed key** for etcd & boot volumes.
- [ ] **Cluster logging** to OCI Logging (control plane + audit).
- [ ] **Backups** with Velero → Object Storage bucket + lifecycle rule.
- [ ] **DR**: cross-region OCIR replication, Terraform state in Object Storage with versioning.
- [ ] **Tag everything**: `Project`, `Environment`, `Owner`, `CostCenter`.

The `oke_recommend_setup` tool returns this checklist tailored to your compartment.

---

## 5. Vault & Secrets patterns

### 5.1 Naming convention
`<env>/<app>/<purpose>` — e.g. `prod/payments/db-password`.

### 5.2 Rotation
- For secrets backed by other OCI services (DB password, OAuth client secret), use **Secret Rotation** with a Function trigger.
- For long-lived API keys, schedule **monthly rotation** via Functions + a Notification topic for failures.

### 5.3 Sync to Kubernetes
Two patterns supported by `oci-extras-mcp`:

1. **Direct sync** — `k8s_create_secret_from_vault` reads OCI Secret, writes K8s Secret. Use only for bootstrapping; secrets become stale.
2. **External Secrets Operator** — `k8s_sync_vault_to_external_secrets` generates an `ExternalSecret` CR. **Recommended for production** — secrets refresh automatically.

### 5.4 Never:
- Log secret values (the audit logger redacts by default).
- Commit `.env` or `.ownership-ledger.json` to git (already in `.gitignore`).
- Use the same KMS key for prod and non-prod.

---

## 6. Functions (FaaS)

- **Stateless only** — no on-disk state; use Object Storage / Vault.
- **Resource Principal** for OCI calls inside the function — never embed API keys.
- **Application logging** to OCI Logging (Functions writes there by default).
- **Cold-start mitigation**: provisioned concurrency for latency-critical paths.

---

## 7. Observability

| Concern | Tool |
|---|---|
| Tail OCI Logging | `streaming_tail_oci_log` (SSE) |
| Tail OKE pod logs | `streaming_tail_pod_logs` (SSE) |
| Metrics queries | upstream `oci-monitoring-mcp-server` |
| Cloud Guard findings | upstream `oci-cloud-guard-mcp-server` |

---

## 8. LLM system-prompt hints

Append the following to your agent's system prompt for safer interactions:

> You have access to oci-mcp tools. **Never call destructive tools without first showing the user the resource's full OCID and asking explicit confirmation.** When a tool returns `requiresHumanAck: true`, you MUST display the message to the user and stop until the user replies "yes" — only then call the tool again with `humanAck: true`. Prefer `dryRun: true` for any first call to a write tool. When dealing with secrets, never request `reveal: true` unless the user asked for the value explicitly.

A copy of this prompt lives in `docs/prompts/`.

---

## 9. Cost guardrails

- Set **Budgets** + **Alerts** in your tenancy.
- Use `oci-pricing-mcp-server` (upstream) before creating expensive resources (BM shapes, GPU node pools).
- Enable **OCI Resource Manager** stack drift detection on Terraform-managed infra to catch out-of-band MCP changes.

---

## 10. Disaster recovery quick wins

1. Cross-region **OCIR replication** of all production images.
2. **Object Storage** bucket replication for Velero backups + Terraform state.
3. **KMS keys** replicated to DR region (Vault → Replication).
4. Document runbook: how to recreate OKE cluster from Velero + IaC.

---

## 11. MCP contract and runtime discipline

- Classify each tool in the canonical policy manifest and derive annotations from it. Registration must fail closed on missing, orphaned or invalid policies.
- Parse inputs strictly and expose the standard output envelope with `outputSchema`. Reject unknown fields instead of silently dropping operator mistakes.
- Use bounded request timeouts and retries. Respect `Retry-After`; reuse one OCI `opcRetryToken` across retries of create operations so an ambiguous response cannot duplicate a resource.
- Keep polling duration, log tails, page sizes, HTTP bodies, session TTL and concurrent sessions within documented hard limits.
- Refresh HTTP session TTL only while idle. Expiry and shutdown must close both transport and MCP server resources.
- Keep audit redaction mandatory and normalize SDK errors before logging them. Test camelCase secret keys, bearer values, query-string credentials and long token-like payloads.
- Validate OCID structure and expected resource type before making an SDK request. A generic OCID is appropriate only where the OCI API legitimately accepts multiple resource types.
