# syntax=docker/dockerfile:1
# Production image for apps/web/landing (Next.js `output: "standalone"`).
#
# BUILD CONTEXT IS apps/web (the pnpm workspace root), because landing compiles
# ../shared and installs through the workspace catalog. From the repo root:
#   docker build -f apps/web/landing/deployments/docker/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://example.com \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#     -t aedst-landing:<git sha> apps/web
# Adapted from apps/web/app/deployments/docker/Dockerfile. NOT verified by a
# local `docker build` (no Docker in the authoring environment): the first
# release run is its acceptance test. Base image tags copied from the app image.

FROM node:26.12.1-trixie-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN npm install --global pnpm@12.15.0
WORKDIR /repo/apps/web

# Dependency layer: workspace manifests only, so source edits keep it cached.
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY landing/package.json ./landing/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @aedst/web-landing...

COPY shared ./shared
COPY landing ./landing

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ARG NEXT_PUBLIC_BING_SITE_VERIFICATION
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION} \
    NEXT_PUBLIC_BING_SITE_VERIFICATION=${NEXT_PUBLIC_BING_SITE_VERIFICATION}

WORKDIR /repo/apps/web/landing
RUN pnpm build

# Runtime: distroless Node, non-root. outputFileTracingRoot is apps/web, so the
# standalone server lives at landing/server.js inside the traced tree.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3002
WORKDIR /app
COPY --from=build --chown=65532:65532 /repo/apps/web/landing/.next/standalone ./
COPY --from=build --chown=65532:65532 /repo/apps/web/landing/.next/static ./landing/.next/static
COPY --from=build --chown=65532:65532 /repo/apps/web/landing/public ./landing/public

USER 65532:65532
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["landing/server.js"]
