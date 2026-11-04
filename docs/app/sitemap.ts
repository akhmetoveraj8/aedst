import type { MetadataRoute } from "next";
import { join } from "node:path";
import { lastModified } from "../lib/content";
import { CONTENT_DIR, allPages } from "../lib/pages";
import { docsUrl } from "../lib/site";

export const dynamic = "force-static";

// lastModified is the last git commit date of each source file. CI must check out with
// fetch-depth: 0 (the docs-ci build job does); on a shallow clone every page gets the same
// date, and without git the DOCS_LASTMOD env var (ISO commit date) is used, else it is omitted.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = docsUrl();
  return allPages().map((p) => ({
    url: `${origin}${p.route === "/" ? "" : p.route}`,
    lastModified: lastModified(join(CONTENT_DIR, p.file)),
  }));
}
