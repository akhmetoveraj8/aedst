# Multi-stage build for the aedst-server binary. Build context is
# apps/server (see Taskfile.yml/server-ci.yml's docker build invocations,
# which pass `-f deployments/docker/Dockerfile .` from apps/server).
#
# Image processing uses govips over libvips (cgo, build tag "vips", ADR-0015),
# so the binary is dynamically linked against glibc + libvips and the old
# CGO_ENABLED=0 / distroless-static runtime no longer works. Both stages use
# Debian 13 (trixie) so the libvips the binary is linked against at build time
# (libvips-dev 8.16.1) is the same library the runtime installs (libvips42t64:
# trixie renamed libvips42 for the 64-bit time_t transition; it still ships
# libvips.so.42). govips 2.20 needs libvips 8.10+ (README: 8.14+).
# NOT verified by a local `docker build` where this was authored (no libvips,
# no Docker): the first CI image build is its acceptance test.
FROM golang:1.27.3-trixie AS build
WORKDIR /src

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc pkg-config libvips-dev \
 && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=1 GOOS=linux go build -tags vips -trimpath -ldflags="-s -w -X github.com/aedst/server/internal/platform/buildinfo.Version=${VERSION}" -o /out/aedst-server ./cmd/server

# Runtime: slim Debian with only libvips42t64 (its dependencies pull in the
# JPEG/PNG/WebP/HEIF/GIF codecs libvips was built with) and CA certificates.
# Runs as a non-root user; no shell tooling beyond what slim ships — use
# `kubectl debug` for in-container debugging.
FROM debian:trixie-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends libvips42t64 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 65532 nonroot \
 && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin nonroot
COPY --from=build /out/aedst-server /aedst-server

USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/aedst-server"]
