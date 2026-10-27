FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl postgresql-client bash ffmpeg

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./prisma.config.ts
# npm ci runs the prepare script, which patches next-ws and then applies our
# own follow-up patch from scripts/. The source tree is not copied until the
# builder stage, so that one file has to come along here.
COPY scripts/patch-next-ws-first-upgrade.mjs ./scripts/
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1

# The production bundle exceeds Node 22's default ~2 GiB heap.
# Scope the larger heap to the build command, not the runtime image.
ARG BUILD_NODE_OPTIONS="--max-old-space-size=4096"
RUN NODE_OPTIONS="$BUILD_NODE_OPTIONS" npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ARG APP_VERSION=development
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Set correct permissions for prerender cache
RUN mkdir .next && chown nextjs:nodejs .next

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy prisma schema and config for migrations
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Copy generated Prisma client
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# Give the install below the lockfile the app was built with. Without it npm
# re-resolves the whole tree against the live registry on every build, so the
# runtime image drifts from what was tested, and a registry change can break
# the build with nothing changed here (npm 10 crashed with "Cannot read
# properties of null (reading 'edgesOut')" resolving vitest's peers this way).
COPY --from=builder --chown=nextjs:nodejs /app/package-lock.json ./package-lock.json

# Replace traced package fragments with the exact production lockfile tree.
# Do not downgrade Prisma or resolve new versions in the runtime image.
# Scripts are skipped here because the custom prepare file is copied below;
# Next's WebSocket patches are then applied explicitly.
RUN npm ci --omit=dev --ignore-scripts

# --ignore-scripts skips Prisma's engine download. Bring the engine installed
# for this exact platform/lockfile from deps so non-root startup stays offline.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma/engines/schema-engine-* ./node_modules/@prisma/engines/

RUN npx next-ws patch --yes

# next-ws reads a route module's exports the moment an upgrade arrives, and
# Next 16.3 loads route modules lazily, so the first WebSocket connection after
# every boot died with "The lazy module is still loading" until the fix below
# is applied to the fresh copy the install above pulled in.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/patch-next-ws-first-upgrade.mjs ./scripts/patch-next-ws-first-upgrade.mjs
RUN node scripts/patch-next-ws-first-upgrade.mjs

# Fail the build here rather than at the first certificate download: a native
# module that cannot be loaded throws while the route module is being
# evaluated, which reaches the browser as an empty HTTP 500 with nothing in it
# to explain itself.
RUN node -e "require('sharp'); console.log('sharp loads')"

# Copy init script
COPY --chown=nextjs:nodejs init-db.sh ./init-db.sh
RUN chmod +x ./init-db.sh

# Create uploads directories
RUN mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./init-db.sh"]
CMD ["node", "server.js"]
