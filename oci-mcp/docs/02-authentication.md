# 02 — Authentication

`oci-extras-mcp` supports all four standard OCI auth modes. The resolver picks
one based on `OCI_AUTH_METHOD`; `auto` (default) tries them in this order:

1. `instance_principal` (when running on an OCI compute VM)
2. `resource_principal` (when running inside an OCI Function/OKE workload)
3. `session_token` (when `~/.oci/config` profile has `security_token_file`)
4. `api_key` (classic key-based config)

## Mode A — API Key (laptops, CI runners)

Generate keys and config interactively:

```powershell
oci setup config
# Profile name: DEFAULT
# Region: sa-saopaulo-1
```

`.env`:

```env
OCI_AUTH_METHOD=api_key
OCI_CONFIG_PROFILE=DEFAULT
OCI_REGION=sa-saopaulo-1
```

Pros: no expiration. Cons: long-lived secret on disk — protect with disk
encryption + ACLs.

## Mode B — Session Token (recommended for human operators)

```powershell
oci session authenticate --region sa-saopaulo-1 --profile-name DEFAULT
```

Browser opens, you sign in, OCI writes a token file referenced by
`security_token_file` in `~/.oci/config`. Refresh with:

```powershell
.\scripts\refresh-oci-session.ps1 -Profile DEFAULT
```

`.env`:

```env
OCI_AUTH_METHOD=session_token
OCI_CONFIG_PROFILE=DEFAULT
```

Tokens last 1h by default and can be refreshed up to the IAM session lifetime
(default 8h, max 24h).

## Mode C — Instance Principal (OCI VMs)

Tag the VM into a Dynamic Group, grant the group the policies you want the MCP
to have. No keys on disk.

`.env`:

```env
OCI_AUTH_METHOD=instance_principal
OCI_REGION=sa-saopaulo-1
```

## Mode D — Resource Principal (OCI Functions / OKE workloads)

Same idea but for serverless/container workloads. The OCI runtime injects
`OCI_RESOURCE_PRINCIPAL_*` env vars; the SDK picks them up automatically.

`.env`:

```env
OCI_AUTH_METHOD=resource_principal
```

## Verifying

```powershell
# Through the MCP (any client):
oci_whoami
```

Expected output includes `tenancyId`, `userOcid` (or principal type),
`region`, and the auth method that won.

## Troubleshooting

- `NotAuthenticated` → token expired. Run `refresh-oci-session.ps1`.
- `NotAuthorizedOrNotFound` → IAM policy missing for the action. See
  `docs/07-security-checklist.md` for least-privilege policies.
- `Could not load private key` → check `key_file` path + permissions in
  `~/.oci/config`.
