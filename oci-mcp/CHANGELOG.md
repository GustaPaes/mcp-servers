# Changelog

All notable changes to **oci-mcp** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

### Added
- Initial release of the **oci-mcp** meta-project.
- `oci-extras-mcp` Node.js MCP server filling gaps from `oracle/mcp` upstream:
  - **OKE (Container Engine for Kubernetes)** — clusters, node pools, addons,
    kubeconfig, work requests, recommendations.
  - **Vault & Secrets** — vaults, KMS keys, secrets CRUD with masking.
  - **Kubernetes layer** — apply manifests, sync OCI Vault → K8s Secret.
  - **OCI Functions** — list, invoke, deploy.
  - **Streaming logs** — tail OCI Logging + OKE pod logs via SSE.
  - **Meta** — whoami, regions, compartments.
- Four authentication methods with auto-resolver: API Key, Session Token,
  Instance Principal, Resource Principal.
- **Ownership ledger** — every resource created by the MCP is tracked locally.
  Mutations on pre-existing resources require explicit confirmation and a
  dedicated env flag (`OCI_MCP_ALLOW_THIRD_PARTY_MUTATION`).
- Safety guards: dry-run default, destructive flag gate, secret reveal gate.
- Pre-built MCP client configurations for Cursor, Claude Desktop, Cline,
  VS Code, OpenCode.
- PowerShell scripts: `install-prereqs.ps1`, `verify-setup.ps1`,
  `refresh-oci-session.ps1`, `generate-mcp-config.mjs`.
- Documentation suite covering installation, authentication, OKE workflows,
  Vault patterns, Compute, troubleshooting, security checklist, and curated
  LLM system prompts.
