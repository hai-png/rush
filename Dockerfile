# P1-60 / OPS-009: Dockerfile for production deployments.
# Multi-stage build using Next.js 16 standalone output mode.

# ─── Stage 1: install deps ───────────────────────────────────────────────────
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (the build will fail without AUTH_SECRET due to env.ts
# validation, so we provide a build-only dummy value; the real secret must
# be set at runtime).
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV AUTH_SECRET=build-only-dummy-secret-32-chars-minimum-length
ENV CRON_SECRET=build-only-dummy-cron-secret-32-chars

RUN bunx prisma generate --schema prisma/schema.prisma
RUN bun run build

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# P2 / DB-050: set the server timezone to Africa/Addis_Ababa so date
# boundaries (subscription expiry, trip departure, monthly reset) align
# with the business timezone. Ethiopia is UTC+3 with no DST.
ENV TZ=Africa/Addis_Ababa

# Run as non-root user for security.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output + static assets.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy prisma schema + migrations dir (for `DATABASE_PROVIDER="${DATABASE_PROVIDER:-postgres}" ./scripts/select-schema.sh && prisma migrate deploy` at startup).
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Create the uploads + db directory with correct ownership.
RUN mkdir -p /app/db/uploads && chown -R nextjs:nodejs /app/db

# P2 #32: run prisma migrations at startup.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

USER nextjs

EXPOSE 3000

# P2 #42: use bun fetch instead of wget (oven/bun may not include wget).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# P2 #32: run DATABASE_PROVIDER="${DATABASE_PROVIDER:-postgres}" ./scripts/select-schema.sh && prisma migrate deploy before starting the server.
CMD ["sh", "-c", "bunx DATABASE_PROVIDER="${DATABASE_PROVIDER:-postgres}" ./scripts/select-schema.sh && prisma migrate deploy --schema prisma/schema.prisma && bun server.js"]
