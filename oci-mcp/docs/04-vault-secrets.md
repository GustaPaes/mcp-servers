# 04 — Vault & Secrets

OCI Vault holds master keys (KMS) and secrets. The MCP exposes the full
lifecycle, with strict default masking.

## Concepts

- **Vault** — the container. Two types: `DEFAULT` (shared HSM) and
  `VIRTUAL_PRIVATE` (dedicated HSM partition).
- **KMS Key** — symmetric AES (often `AES_256`) used to wrap secret payloads.
- **Secret** — versioned blob (base64) wrapped by a KMS key.

## Tool catalogue

| Tool                       | Purpose                                          |
|----------------------------|--------------------------------------------------|
| `vault_list` / `vault_get` | Read vaults                                      |
| `vault_create`             | Create a new vault (mutating)                    |
| `kms_list_keys`            | List keys in a vault                             |
| `kms_create_key`           | Create AES key                                   |
| `kms_rotate_key`           | Rotate key material                              |
| `kms_disable_key`          | Schedule deletion                                |
| `secret_list`              | List secrets in a vault                          |
| `secret_get`               | **Masked by default**                            |
| `secret_create`            | Create + record in ledger                        |
| `secret_update`            | New version                                      |
| `secret_delete`            | Schedule deletion                                |
| `secret_register_existing` | Adopt a pre-existing secret OCID                 |

## Reading a secret value

`secret_get` returns metadata + a masked preview. To get the cleartext:

```text
secret_get { secretId, reveal: true }
```

Requires:

- `OCI_MCP_ALLOW_SECRET_REVEAL=true` in env.
- The audit log records the reveal event with timestamp + caller.

If both conditions aren't met, the call fails closed.

## Recipe — create vault + key + secret

```text
1. vault_create { compartmentId, name: "app-prod", vaultType: "DEFAULT" }
   → vaultId
2. kms_create_key { vaultId, name: "app-prod-master", algorithm: "AES", length: 32 }
   → kmsKeyId
3. secret_create { vaultId, kmsKeyId, name: "db-password",
                   value: "p@ssw0rd!", description: "prod DB" }
```

All three are recorded in the ownership ledger automatically.

## Recipe — rotate a key without breaking apps

```text
1. kms_rotate_key { keyId }      # new version becomes current
2. App keeps decrypting old payloads (KMS retains versions).
3. secret_update { secretId, value: <new value> }
   → now wrapped under the new key version.
```

## Mapping Vault → Kubernetes

Use `k8s_create_secret_from_vault` (one-shot) or
`k8s_sync_vault_to_external_secrets` (writes an `ExternalSecret` resource if
[external-secrets](https://external-secrets.io) is installed in the cluster).

## Anti-patterns

- Storing more than ~25 KB per secret — split or use Object Storage + KMS.
- Hard-coding `compartmentId`/`vaultId` in client prompts — discover via
  `oci_list_compartments` + `vault_list`.
- Asking the LLM to print a secret value to chat — the MCP will refuse unless
  the explicit reveal flow is followed.
