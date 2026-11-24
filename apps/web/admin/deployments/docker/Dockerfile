# syntax=docker/dockerfile:1
# Production image for apps/web/admin: the Vite single-page app (static dist/)
# and its Hono backend-for-frontend (one bundled file, dist-server/main.mjs)
# in ONE process on port 3001.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT: the ConnectRPC client stubs in
# apps/web/shared/api/connect/generated are generated at build time from
# apps/server/api/proto (they are not committed), and the admin project
# compiles the source-only apps/web/shared kit next to it. From the repo root:
#   docker build -f apps/web/admin/deployments/docker/Dockerfile \
#     --build-arg VITE_SITE_URL=https://admin.example.com \
#     --build-arg VITE_APP_URL=https://app.example.com \
#     --build-arg SENTRY_RELEASE=<git sha> -t aedst-web-admin:<git sha> .
# The ignore list is Dockerfile.dockerignore next to this file (BuildKit).
#
# Image pinning follows apps/web/app/deployments/docker/Dockerfile (same base
# image tags and pnpm version). NOT verified by a local `docker build` (no
# Docker in the authoring environment): the first release run is its
# acceptance test. The workspace layout (pnpm-workspace.yaml and a lockfile at
# apps/web) is assumed from the web split; UNVERIFIED.
#
# VITE_* values are inlined into the static bundle at build time, so they are
# build args; everything the BFF needs (ADMIN_ORIGIN, API_BASE_URL, OIDC_*,
# AUTH_*, SENTRY_DSN) is read at runtime, see server/.env.example.

FROM node:26.13.1-trixie-slim AS build
ENV CI=1
RUN npm install --global pnpm@12.23.0
WORKDIR /repo/apps/web

# Dependency layer: only manifests, so source edits keep the install cached.
COPY apps/web/package.json apps/web/pnpm-workspace.yaml apps/web/pnpm-lock.yaml ./
COPY apps/web/shared/package.json shared/package.json
COPY apps/web/app/package.json app/package.json
COPY apps/web/admin/package.json admin/package.json
COPY apps/web/marketing/package.json marketing/package.json
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

ARG VITE_SITE_URL
ARG VITE_APP_URL
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT=production
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ENV VITE_SITE_URL=${VITE_SITE_URL} \
    VITE_APP_URL=${VITE_APP_URL} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_SENTRY_ENVIRONMENT=${VITE_SENTRY_ENVIRONMENT} \
    SENTRY_ORG=${SENTRY_ORG} \
    SENTRY_PROJECT=${SENTRY_PROJECT} \
    SENTRY_RELEASE=${SENTRY_RELEASE}

# The Sentry auth token is a BuildKit secret, never an ARG/ENV: with it,
# `vite build` uploads this build's source maps and deletes them from the
# output; without it the upload is skipped. The last check fails the build if
# a source map would ship in the image.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    pnpm --filter @aedst/web-app connect:generate \
 && pnpm --filter @aedst/web-admin build:all \
 && ! find admin/dist -name "*.map" | grep -q .

# Runtime: distroless Node (no shell, no package manager), non-root. The BFF is
# one esbuild bundle with its dependencies inlined, so the image holds only
# dist/ (static files), dist-server/main.mjs and no node_modules.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
COPY --from=build --chown=65532:65532 /repo/apps/web/admin/dist ./dist
COPY --from=build --chown=65532:65532 /repo/apps/web/admin/dist-server/main.mjs ./dist-server/main.mjs

USER 65532:65532
EXPOSE 3001
# No curl/wget in distroless: probe with the bundled node. Kubernetes ignores
# HEALTHCHECK and uses httpGet probes on /api/healthz.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["dist-server/main.mjs"]
