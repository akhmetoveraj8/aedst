---
title: "ADR-0015: govips/libvips for Ingest, imgproxy for Delivery"
description: "Accepted (owner decision). Replaces golang.org/x/image in the media module."
---

# ADR-0015: govips/libvips for Ingest, imgproxy for Delivery

## Status
Accepted (owner decision). Replaces `golang.org/x/image` in the media module.
**Verification:** the libvips code path (`images_vips.go`, build tag `vips`), the
Docker image, the imgproxy compose service and the Helm templates were written on a
machine with `CGO_ENABLED=0`, no gcc, no libvips, no Docker and no Helm. They were
**not compiled, built or run** there. The default (non-`vips`) build, the unit tests
with a fake processor, the signer and the config validation were run. The first CI
run of the `unit-vips` job and of `docker-build` is the acceptance test of the rest.

## Context
The media worker decoded every upload with the Go standard library and
`golang.org/x/image`, then pre-generated three fixed renditions (`thumbnail` 256,
`preview` 1280, `optimized` 2560) for every image. That has three problems:

- Pure-Go decode/resize is slow and memory-hungry for large images, and cannot read
  HEIC/AVIF or write WebP/AVIF at all.
- Pre-generating sizes nobody asked for costs CPU and storage per upload, and a new
  size means reprocessing the whole library.
- It never stripped EXIF/GPS or honoured EXIF orientation: the original (with the
  user's location) was stored and served as uploaded.

## Decision

```
Upload -> AEDST Media Service -> govips/libvips (validate, strip EXIF/GPS,
auto-orient, normalize) -> S3/R2/MinIO (one sanitized original)
        -> imgproxy (dynamic sizes, WebP/AVIF) -> CDN -> client
```

**Rule: never run the same operation in both stages.** govips prepares and sanitizes
the ORIGINAL (and any derivative that needs AEDST business logic). Generic
size/format variants are produced on demand by imgproxy, which uses libvips itself.
There is no govips inside imgproxy and no pre-generated generic renditions.

**Ingest (`internal/modules/media/infrastructure/processing`)**
- `govips` v2.20.0 over system libvips (cgo), behind an `ImageProcessor` interface
  (`Sanitize`). Real implementation: `images_vips.go` (`//go:build vips`). Default
  builds get `images_novips.go`, which returns `ErrImagingUnavailable` ("built
  without libvips (-tags vips)"), deliberately distinct from `ErrUnprocessable`: a
  deployment error is retried, it never marks the user's file `FAILED`.
- Order inside `Sanitize`: header read first (libvips loads lazily) and refusal over
  `AEDST_MEDIA_MAX_IMAGE_PIXELS` before any decode; check the loaded format equals the
  declared content type; auto-orient; re-encode with all metadata stripped.
- Canonical stored original: same type as uploaded (JPEG q90 optimized+interlaced,
  PNG with alpha, WebP q90), written over the raw upload under the same object key.
  Animated GIF and animated WebP are validated and stored **unmodified** (re-encoding
  would flatten or bloat them; GIF has no EXIF).
- `libvips` lifecycle: `processing.StartImaging()` in `cmd/server` (a no-op without
  the tag), stopped on shutdown. ICC profiles are dropped with the metadata (sRGB is
  assumed); revisit if wide-gamut fidelity matters.
- `media.v1` no longer produces `thumbnail`/`preview`/`optimized` for new images.
  Video posters are still produced by ffmpeg (unchanged), as a single `poster`
  variant; the old poster thumbnail is gone.

**Delivery (`internal/platform/imgproxy` + imgproxy service)**
- imgproxy (`darthsim/imgproxy`, tag `v4.0.20` verified on Docker Hub on 2026-10-28)
  reads the original from the bucket (`s3://bucket/key`) and renders presets
  `thumb_64`, `avatar_256`, `card_400`, `feed_800x600`, `story_1080x1350` as
  WebP/AVIF/JPEG negotiated from the `Accept` header (no extension in the URL).
- The server only **signs URLs** (HMAC-SHA256 over `salt+path`, URL-safe base64, the
  scheme in the imgproxy docs; the unit test uses the published docs vector). Config:
  `AEDST_IMGPROXY_ENABLED/URL/KEY/SALT/URL_TTL_SECONDS`; key and salt must equal
  imgproxy's `IMGPROXY_KEY/SALT`. URLs carry `exp`, rounded to a TTL window so they
  stay stable and CDN-cacheable.
- Presets live in imgproxy's `IMGPROXY_PRESETS` (compose and Helm use the string in
  `imgproxy.PresetsEnv`). `IMGPROXY_ONLY_PRESETS` is not used because that mode
  disallows the `exp` option; signatures already stop clients crafting transformations.
- Wire contract: `media.v1.VariantKind` is `POSTER=4` plus `THUMB_64=5, AVATAR_256=6,
  CARD_400=7, FEED_800X600=8, STORY_1080X1350=9`; 1-3 are `reserved`. Clients pick by
  UI context (avatars `avatar_256`, lists `thumb_64`/`card_400`, feeds `feed_800x600`,
  stories `story_1080x1350`), then the nearest preset, then the poster, then the
  original; the uncropped full-size view and video playback use the original. `Media.variants`
  carries these (with `url` and the preset's target box; `content_type`/`size_bytes`
  are empty because the format is negotiated) for images, and for videos derived from
  the stored poster. When imgproxy is disabled nothing is added and clients use
  `Media.url` (the original).

## Consequences
- The server image becomes dynamically linked: `golang:1.27-trixie` builder (moved from bookworm; Debian 13, glibc 2.41) with
  `libvips-dev`, runtime `debian:trixie-slim` with `libvips42t64` (the trixie name of libvips42 after the t64 transition; libvips 8.16.1), non-root uid 65532.
  Distroless-static no longer works with cgo.
- CI gains `unit-vips` (installs `libvips-dev`, `go vet -tags vips`, `task test:vips`,
  `task build:vips`). Default lint/test jobs do not compile the tagged files.
- `golang.org/x/image` is no longer imported by AEDST code; it stays in `go.mod` as an
  indirect dependency of govips.
- Known gaps: `media.size_bytes` and the `MediaReady` event keep the **uploaded** size,
  not the sanitized size (the row is not updated by `MarkReady`). A retry after the
  sanitized original was written re-encodes it once more (images are bounded by
  `AEDST_MEDIA_MAX_IMAGE_BYTES` instead of the exact size check). Existing rows keep
  their old stored variants, but the legacy kinds are no longer sent: the proto
  `reserved`s 1-3 (`THUMBNAIL`/`PREVIEW`/`OPTIMIZED`) and the server drops the
  corresponding domain constants (no production data existed to migrate). All four
  clients now select by the new kinds and fall back to the original only when no
  variant exists: Web (tests and lint run), Android, Apple and Desktop (**not
  compiled**: no JDK/SDK, Xcode or Desktop toolchain was available, so those edits are
  unverified until their first build).
- Operating imgproxy: set `IMGPROXY_MAX_SRC_RESOLUTION`/`MAX_SRC_FILE_SIZE`, keep
  `ALLOWED_SOURCES` to the one bucket, front it with a CDN, and give it read-only
  credentials. The imgproxy environment-variable names (`IMGPROXY_AUTO_WEBP`,
  `IMGPROXY_AUTO_AVIF`, S3 variables) were read from docs.imgproxy.net (v4) and were
  not exercised against a running instance.

## Revisit when
- A derivative needs AEDST business logic (watermark, face-aware crop, content
  moderation blur): produce it in govips at ingest, never in imgproxy.
- imgproxy becomes a cost or ops burden (managed image CDN, or Cloudflare Images
  proves cheaper); the `Signer` is the only seam.
- HEIC/AVIF uploads are added to the allow-list (libvips already supports them via
  libheif; the allow-list, sniffing and `expectedFormat` change).
