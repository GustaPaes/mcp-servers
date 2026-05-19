# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    OCI_MCP_DEFAULT_DRY_RUN=true \
    OCI_MCP_ALLOW_DESTRUCTIVE=false \
    OCI_MCP_ALLOW_THIRD_PARTY_MUTATION=false \
    OCI_MCP_ALLOW_SECRET_REVEAL=false \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3020

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/logs /app/state && chown -R mcp:mcp /app
USER mcp

EXPOSE 3020

# Default: HTTP transport (use stdio when running interactively)
CMD ["node", "index.js", "--http"]
