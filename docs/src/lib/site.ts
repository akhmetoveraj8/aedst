// Site-wide configuration read from the environment. Nothing here is a secret.
//
//   NEXT_PUBLIC_DOCS_URL            canonical origin, e.g. https://docs.example.com (trailing slash tolerated)
//   NEXT_PUBLIC_DOCS_REPO_BASE      "Edit this page" base, e.g. https://github.com/org/repo/tree/main/docs/content
//                                   (unset: no edit link is rendered)
//   NEXT_PUBLIC_DOCS_LICENSE        footer licence text (unset: honest default below)
//   DOCS_LASTMOD                    ISO commit date used for sitemap lastModified when git history is unavailable
//   DOCS_ALLOW_AI_TRAINING          "true" to allow AI training crawlers in robots.txt (default: disallow)

type Env = Record<string, string | undefined>;

const LOCAL_ORIGIN = "http://localhost:3000";

/** Absolute origin of the docs site. Falls back to localhost so dev and CI builds still work. */
export function docsUrl(env: Env = process.env): string {
  const raw = env.NEXT_PUBLIC_DOCS_URL?.trim();
  return (raw || LOCAL_ORIGIN).replace(/\/+$/, "");
}

/** The configured origin, or undefined (then metadataBase is omitted). */
export function configuredDocsUrl(env: Env = process.env): string | undefined {
  return env.NEXT_PUBLIC_DOCS_URL?.trim() ? docsUrl(env) : undefined;
}

export function docsRepositoryBase(env: Env = process.env): string | undefined {
  return env.NEXT_PUBLIC_DOCS_REPO_BASE?.trim() || undefined;
}

// The owner has not chosen a licence (the repository intentionally has no LICENSE file),
// so the default must not claim one.
export const DEFAULT_LICENSE = "All rights reserved - licence not yet chosen";

export function docsLicense(env: Env = process.env): string {
  return env.NEXT_PUBLIC_DOCS_LICENSE?.trim() || DEFAULT_LICENSE;
}

export const SITE_NAME = "AEDST docs";
export const SITE_DESCRIPTION = "Architecture, module boundaries and decision records for the AEDST monorepo.";
