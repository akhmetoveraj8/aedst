# syntax=docker/dockerfile:1
# Production image for apps/web/app, the product app (Next.js `output: "standalone"`).
#
# BUILD CONTEXT IS THE REPOSITORY ROOT: the ConnectRPC client stubs in
# apps/web/shared/api/connect/generated are generated at build time from
# apps/server/api/proto (they are not committed), and the app compiles the
# source-only apps/web/shared kit next to it. From the repo root:
#   docker build -f apps/web/app/deployments/docker/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://app.example.com \
#     --build-arg SENTRY_RELEASE=<git sha> -t aedst-web:<git sha> .
# The ignore list is Dockerfile.dockerignore next to this file (BuildKit).
#
# Image pinning follows apps/server/deployments/docker/Dockerfile: base images
# are pinned by exact version tag (no floating "latest"), not by digest. The
# tags were verified to exist (node 26.13.1-trixie-slim on Docker Hub,
# gcr.io/distroless/nodejs26-debian13:nonroot) when this file was written.
# NOT verified by a local `docker build` (no Docker in the authoring
# environment): the first web-release run is its acceptance test.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they are build args; everything else (API_BASE_URL, OIDC_*, AUTH_*,
# MEDIA_ORIGINS) is read at runtime. See docs/content/web/deployment.md.

FROM node:26.13.1-trixie-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN npm install --global pnpm@12.21.0
WORKDIR /repo/apps/web

# Dependency layer: only manifests, so source edits keep the install cached.
# The lockfile and catalog are workspace-wide; only this project and shared are installed.
COPY apps/web/package.json apps/web/pnpm-workspace.yaml apps/web/pnpm-lock.yaml ./
COPY apps/web/shared/package.json shared/package.json
COPY apps/web/app/package.json app/package.json
COPY apps/web/admin/package.json admin/package.json
COPY apps/web/landing/package.json landing/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @aedst/web-app...

# Proto sources for `pnpm connect:generate` (buf resolves buf.lock deps online).
COPY apps/server/buf.yaml apps/server/buf.lock /repo/apps/server/
COPY apps/server/api/proto /repo/apps/server/api/proto
COPY apps/web/shared shared
COPY apps/web/app app

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_PRIVACY_POLICY_URL
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ARG NEXT_PUBLIC_BING_SITE_VERIFICATION
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST} \
    SENTRY_ORG=${SENTRY_ORG} \
    SENTRY_PROJECT=${SENTRY_PROJECT} \
    SENTRY_RELEASE=${SENTRY_RELEASE}

# A release build refuses placeholder SEO copy and a localhost site URL
# (../shared/scripts/check-seo-placeholders.mjs, run by `prebuild`). Pass 0 only for a
# deliberate staging image.
ARG AEDST_REQUIRE_REAL_SEO=1
ENV AEDST_REQUIRE_REAL_SEO=${AEDST_REQUIRE_REAL_SEO}

# The Sentry auth token is a BuildKit secret, never an ARG/ENV: it is not in
# the image history or layers. With it, `next build` uploads the source maps
# of THIS build and deletes them from the output (next.config.ts); without it
# the upload is skipped. Pass it only from web-release.yml.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    pnpm --filter @aedst/web-app connect:generate \
 && pnpm --filter @aedst/web-app build \
 && ! find app/.next/static -name "*.map" | grep -q .

# Runtime: distroless Node (no shell, no package manager), non-root. The
# standalone output is rooted at apps/web (the workspace tracing root), so the server is app/server.js;
# static assets and public/ are not traced, so they are copied next to it.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=65532:65532 /repo/apps/web/app/.next/standalone ./
COPY --from=build --chown=65532:65532 /repo/apps/web/app/.next/static ./app/.next/static
COPY --from=build --chown=65532:65532 /repo/apps/web/app/public ./app/public

USER 65532:65532
EXPOSE 3000
# No curl/wget in distroless: probe with the bundled node. Kubernetes ignores
# HEALTHCHECK and uses the httpGet probes of the Helm chart.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["app/server.js"]
