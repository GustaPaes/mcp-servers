# 07 — Security Checklist

A pragmatic checklist to deploy this toolkit without giving an LLM a loaded
gun.

## 1. Identity & Access

- [ ] Dedicated IAM user/group (or Dynamic Group for instance principal).
- [ ] Least-privilege policies — start with read-only, expand per service.
- [ ] MFA enforced on all human users that authenticate the MCP.
- [ ] Rotate API keys quarterly (or use session tokens which auto-expire).

### Minimal read-only policy

```text
allow group MCP-Operators to read all-resources in compartment <compartment>
```

### Add OKE write (when you really need it)

```text
allow group MCP-Operators to manage cluster-family in compartment <compartment>
allow group MCP-Operators to use vnics in compartment <compartment>
allow group MCP-Operators to use subnets in compartment <compartment>
allow group MCP-Operators to use network-security-groups in compartment <compartment>
```

### Add Vault write

```text
allow group MCP-Operators to manage vaults in compartment <compartment>
allow group MCP-Operators to manage keys in compartment <compartment>
allow group MCP-Operators to manage secret-family in compartment <compartment>
```

## 2. MCP safety flags

| Flag                                     | Default | Recommended for prod |
|------------------------------------------|---------|----------------------|
| `OCI_MCP_DEFAULT_DRY_RUN`                | `true`  | `true`               |
| `OCI_MCP_ALLOW_DESTRUCTIVE`              | `false` | `false` (toggle per session) |
| `OCI_MCP_ALLOW_THIRD_PARTY_MUTATION`     | `false` | `false` always       |
| `OCI_MCP_ALLOW_SECRET_REVEAL`            | `false` | `false` always; toggle per task |

Treat them as runtime kill switches. Toggle them on for a specific operation
then turn back off — the environment file reload happens on server restart.

## 3. Filesystem

- [ ] `.env` excluded from git (already in `.gitignore`).
- [ ] `~/.oci/config` and key files: `icacls` to user-only.
- [ ] Audit log directory writable only by the MCP user.
- [ ] Ledger file backed up — losing it means the MCP loses awareness of what
      it owns and will require re-registration.

## 4. Network

- [ ] If running HTTP transport, bind to `127.0.0.1` unless behind a reverse
      proxy with auth.
- [ ] Never expose `/mcp` to the public internet without a tokenized auth
      gateway in front (the MCP itself does no auth).

## 5. LLM/Client side

- [ ] Approve `autoApprove` lists only for **read** tools (see Cline config).
- [ ] All write tools must require human confirmation in the chat UI.
- [ ] Keep a system prompt that:
  - Forbids printing secret values.
  - Requires explicit OCID + action confirmation before destructive calls.
  - Encourages dry-run first.

See `docs/prompts/` for ready-made system prompts.

## 6. Audit

- [ ] Ship `logs/audit.jsonl` to a SIEM (CloudWatch / OCI Logging / Splunk).
- [ ] Monitor for `secret_reveal` events and third-party mutation attempts.
- [ ] Periodically diff the ledger against actual resources to detect drift.
