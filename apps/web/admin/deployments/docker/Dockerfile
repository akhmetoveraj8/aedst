# syntax=docker/dockerfile:1
# Production image for apps/web/admin (Next.js `output: "standalone"`).
#
# BUILD CONTEXT IS THE REPOSITORY ROOT: the ConnectRPC client stubs in
# apps/web/shared/api/connect/generated are generated at build time from
# apps/server/api/proto (they are not committed), and the admin project
# compiles the source-only apps/web/shared kit next to it. From the repo root:
#   docker build -f apps/web/admin/deployments/docker/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://admin.example.com \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#     --build-arg SENTRY_RELEASE=<git sha> -t aedst-web-admin:<git sha> .
# The ignore list is Dockerfile.dockerignore next to this file (BuildKit).
#
# Image pinning follows apps/web/app/deployments/docker/Dockerfile (same base
# image tags and pnpm version). NOT verified by a local `docker build` (no
# Docker in the authoring environment): the first release run is its
# acceptance test. The workspace layout (pnpm-workspace.yaml and a lockfile at
# apps/web) is assumed from the web split; UNVERIFIED.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they are build args; everything else (API_BASE_URL, OIDC_*, AUTH_*) is read
# at runtime.

FROM node:26.12.1-trixie-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN npm install --global pnpm@12.15.0
WORKDIR /repo/apps/web

# Dependency layer: only manifests, so source edits keep the install cached.
COPY apps/web/package.json apps/web/pnpm-workspace.yaml apps/web/pnpm-lock.yaml ./
COPY apps/web/shared/package.json shared/package.json
COPY apps/web/app/package.json app/package.json
COPY apps/web/admin/package.json admin/package.json
COPY apps/web/landing/package.json landing/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @aedst/web-admin... --filter @aedst/web-app

# Proto sources for code generation. The app project is installed too (its devDependencies
# hold buf and protoc-gen-es);
# its generator script and buf.gen.yaml write to
# apps/web/shared/api/connect/generated.
COPY apps/server/buf.yaml apps/server/buf.lock /repo/apps/server/
COPY apps/server/api/proto /repo/apps/server/api/proto
COPY apps/web/shared shared
COPY apps/web/app/buf.gen.yaml app/
COPY apps/web/app/scripts/connect-generate.mjs app/scripts/
COPY apps/web/admin admin

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT} \
    SENTRY_ORG=${SENTRY_ORG} \
    SENTRY_PROJECT=${SENTRY_PROJECT} \
    SENTRY_RELEASE=${SENTRY_RELEASE}

# The Sentry auth token is a BuildKit secret, never an ARG/ENV: with it,
# `next build` uploads this build's source maps and deletes them from the
# output (next.config.ts); without it the upload is skipped.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    pnpm --filter @aedst/web-app connect:generate \
 && pnpm --filter @aedst/web-admin build \
 && ! find admin/.next/static -name "*.map" | grep -q .

# Runtime: distroless Node (no shell, no package manager), non-root. The
# standalone output is rooted at apps/web (the tracing root), so the server is
# admin/server.js; static assets are not traced and are copied next to it.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001
WORKDIR /app
COPY --from=build --chown=65532:65532 /repo/apps/web/admin/.next/standalone ./
COPY --from=build --chown=65532:65532 /repo/apps/web/admin/.next/static ./admin/.next/static

USER 65532:65532
EXPOSE 3001
# No curl/wget in distroless: probe with the bundled node. Kubernetes ignores
# HEALTHCHECK and uses httpGet probes on /api/healthz.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["admin/server.js"]
