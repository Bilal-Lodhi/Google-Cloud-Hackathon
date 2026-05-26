# ─────────────────────────────────────────────────────────────────────────────
# Google Cloud Rapid Agent Hackathon 2026 — Production Dockerfile
# Target: Google Cloud Run (serverless container)
# Stack: Hono API + MCP Server (MongoDB Partner Track)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json package-lock.json tsconfig.json ./
COPY sandbox/hono-api/package.json sandbox/hono-api/tsconfig.json ./sandbox/hono-api/
COPY sandbox/mcp-server/package.json sandbox/mcp-server/tsconfig.json ./sandbox/mcp-server/

# Install all workspace dependencies
RUN npm ci --ignore-scripts

# Copy source files
COPY sandbox/hono-api/src ./sandbox/hono-api/src
COPY sandbox/mcp-server/src ./sandbox/mcp-server/src

# Build TypeScript
RUN npm run build --workspace=sandbox/hono-api --workspace=sandbox/mcp-server

# ── Stage 2: Production Runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Install dumb-init for proper signal handling in Cloud Run
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user (Cloud Run best practice)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production dependency manifests
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/sandbox/hono-api/package.json ./sandbox/hono-api/
COPY --from=builder /app/sandbox/mcp-server/package.json ./sandbox/mcp-server/

# Install production-only dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled JavaScript output
COPY --from=builder /app/sandbox/hono-api/dist ./sandbox/hono-api/dist
COPY --from=builder /app/sandbox/mcp-server/dist ./sandbox/mcp-server/dist

# Switch to non-root user
USER appuser

# Expose Cloud Run default port
EXPOSE 8080

# Health check using Hono health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start both the Hono API and MCP server
# The MCP server runs on port 3001 (internal), Hono on 8080 (external)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "sandbox/hono-api/dist/index.js"]