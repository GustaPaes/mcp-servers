# 03 — OKE Workflows

End-to-end recipes for OKE clusters using the `oke_*` and `k8s_*` tools.

## Recipe 1 — Brand-new dev cluster

```text
1. oke_recommend_setup { compartmentId, profile: "dev" }
   → returns a recommended VCN + LB + node-pool plan.

2. oke_create_cluster {
     compartmentId, name: "dev-cluster",
     vcnId, kubernetesVersion: "v1.30.1",
     endpointConfig: { subnetId: <api-subnet>, isPublicIpEnabled: false },
     dryRun: true                       # preview
   }

3. Same call with dryRun:false, confirm:true → returns workRequestId.

4. oke_track_create { workRequestId }    # poll until SUCCEEDED.

5. oke_get_kubeconfig { clusterId, mergeIntoLocal: true }
   → kubeconfig merged at $env:KUBECONFIG (or ~/.kube/config).

6. k8s_list_namespaces                   # smoke test.
```

## Recipe 2 — Add a node pool

```text
oke_create_node_pool {
  clusterId, compartmentId,
  name: "workers-1",
  shape: "VM.Standard.E4.Flex",
  shapeConfig: { ocpus: 2, memoryInGBs: 16 },
  size: 3,
  subnetIds: [<worker-subnet>],
  dryRun: false, confirm: true
}
```

`oke_scale_node_pool { nodePoolId, size: 5 }` to resize.

## Recipe 3 — Deploy from a manifest with secrets from Vault

```text
1. secret_create { vaultId, kmsKeyId, name: "db-password", value: "..." }
   → returns secretId, recorded in ledger.

2. k8s_create_secret_from_vault {
     namespace: "app",
     name: "db-creds",
     mappings: [{ key: "password", secretId: <id> }]
   }
   → creates k8s Secret app/db-creds, also recorded.

3. k8s_apply_manifest {
     manifest: <yaml string or path>,
     namespace: "app"
   }
   → applies; every created object is tagged Owner=oci-extras-mcp.
```

## Recipe 4 — Adopting an existing cluster

The MCP refuses to mutate resources it didn't create unless you adopt them:

```text
oke_register_existing { clusterId, reason: "cluster created by Terraform" }
```

After registration the standard guard rails kick in (dryRun → confirm →
audit log). Without registration, mutating tools require
`humanAck:true` AND `OCI_MCP_ALLOW_THIRD_PARTY_MUTATION=true`.

## Recipe 5 — Tear down (destructive!)

```text
1. oke_list_node_pools { clusterId }
2. oke_delete_node_pool { nodePoolId, dryRun: true }   # preview
3. oke_delete_node_pool { nodePoolId, confirm: true }
4. oke_delete_cluster { clusterId, dryRun: true }
5. oke_delete_cluster { clusterId, confirm: true }
```

Requires `OCI_MCP_ALLOW_DESTRUCTIVE=true`.

## LLM tip

Always plan with `oke_recommend_setup` before `oke_create_cluster`. When
showing destructive previews, repeat the resource OCID and the exact action
back to the user and wait for explicit approval.
