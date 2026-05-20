# --- Build stage ---------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage -------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production deps in the final image
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp \
    && mkdir -p /app/data /app/config \
    && chown -R mcp:mcp /app
USER mcp

# MCP uses stdio by default; expose nothing.
ENTRYPOINT ["node", "dist/server.js"]
