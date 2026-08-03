# MCP Servers by GustaPaes

> Curated collection of Model Context Protocol servers I use in my daily engineering workflow. Public docs and examples are generalized where environment-specific details would not make sense to publish.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.x-6f42c1)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520.19-339933?logo=node.js&logoColor=white)](https://nodejs.org)

## Choose Your Language

- [English documentation](./README.en.md)
- [Documentacao em Portugues](./README.pt-BR.md)

## Projects

- [`azure-mcp`](./azure-mcp) - Azure Cloud operations through the official Microsoft Azure MCP server.
- [`meta-ads-mcp`](./meta-ads-mcp) - Multi-account Facebook / Instagram Ads MCP with dry-run, audit and budget caps.
- [`tfs-mcp`](./tfs-mcp) - Generic TFS / Azure DevOps Server work items, custom process profiles, PRs, review, delivery workflows and specialist-routed guidance.
- [`oci-mcp`](./oci-mcp) - Oracle Cloud Infrastructure toolkit plus custom OKE/Vault/Functions tools.
- [`playwright-mcp`](./playwright-mcp) - Multi-session Playwright MCP with HAR, video, tracing and network tools.
- [`career-development-mcp`](./career-development-mcp) - PDI, goals, competencies, evidence and career review MCP.

## Quick Start

Start with the full documentation in your language:

- [English: install, safety model, client snippets and project map](./README.en.md)
- [Portugues: instalacao, modelo de seguranca, snippets e mapa dos projetos](./README.pt-BR.md)

Install and validate the complete workspace with `npm install` followed by
`npm run validate` (`npm run validate:fast` is available for quick iteration).
Keep organization-specific configuration, adapters,
runbooks and exports under each project's ignored `local-private/` directory.
