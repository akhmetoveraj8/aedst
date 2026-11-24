# syntax=docker/dockerfile:1
# Production image for apps/web/marketing (Next.js `output: "export"` served by nginx).
#
# BUILD CONTEXT IS apps/web (the pnpm workspace root), because marketing compiles
# ../shared and installs through the workspace catalog. From the repo root:
#   docker build -f apps/web/marketing/deployments/docker/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://example.com \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#     -t aedst-marketing:<git sha> apps/web
# Adapted from apps/web/app/deployments/docker/Dockerfile. NOT verified by a
# local `docker build` (no Docker in the authoring environment): the first
# release run is its acceptance test. Base image tags copied from the app image.

FROM node:26.13.1-trixie-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN npm install --global pnpm@12.23.0
WORKDIR /repo/apps/web

# Dependency layer: workspace manifests only, so source edits keep it cached.
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY marketing/package.json ./marketing/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @aedst/web-marketing...

COPY shared ./shared
COPY marketing ./marketing

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ARG NEXT_PUBLIC_BING_SITE_VERIFICATION
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION} \
    NEXT_PUBLIC_BING_SITE_VERIFICATION=${NEXT_PUBLIC_BING_SITE_VERIFICATION}

# A release build refuses placeholder SEO copy and a localhost site URL
# (../shared/scripts/check-seo-placeholders.mjs, run by `prebuild`). Pass 0 only
# for a deliberate staging image.
ARG AEDST_REQUIRE_REAL_SEO=1
ENV AEDST_REQUIRE_REAL_SEO=${AEDST_REQUIRE_REAL_SEO}

WORKDIR /repo/apps/web/marketing
RUN pnpm build

# Runtime: nginx (non-root, port 8080) serving the static export. The build
# step generated the per-page CSP (SHA-256 of each inline script) next to out/:
# nginx.conf routes, headers/*.conf carry the policy. See
# docs/content/web/marketing-static.md.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24 AS runtime
COPY --chown=101:101 marketing/deployments/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=101:101 /repo/apps/web/marketing/headers/nginx-common.conf /repo/apps/web/marketing/headers/nginx-pages.conf /etc/nginx/aedst/
COPY --from=build --chown=101:101 /repo/apps/web/marketing/out /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/robots.txt"]
