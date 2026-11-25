import { locales, toLanguageTag } from "@/shared/i18n/locales";
import {
  type PublicRoute,
  publicRouteUrl,
} from "@/shared/lib/seo/public-route";

/**
 * Body of /llms.txt (llmstxt.org format: H1, blockquote summary, H2 sections
 * of links), built from a project's site config and public route table so it
 * cannot drift from the sitemap. `note` is the one paragraph that differs per
 * project (what is not indexable and why).
 */
export function buildLlmsTxt({
  site,
  routes,
  note,
}: {
  site: { name: string; description: string; url: URL };
  routes: readonly Pick<PublicRoute, "pathname" | "label">[];
  note: string;
}): string {
  const pages = routes.flatMap((route) =>
    locales.map(
      (locale) =>
        `- [${route.label} (${toLanguageTag(locale)})](${publicRouteUrl(locale, route.pathname, site.url)})`,
    ),
  );
  const machine = [
    { label: "Sitemap", path: "/sitemap.xml" },
    { label: "Robots policy", path: "/robots.txt" },
  ].map(
    ({ label, path }) => `- [${label}](${new URL(path, site.url).toString()})`,
  );

  return [
    `# ${site.name}`,
    "",
    `> ${site.description}`,
    "",
    note,
    "",
    "## Pages",
    "",
    ...pages,
    "",
    "## Machine-readable",
    "",
    ...machine,
    "",
  ].join("\n");
}
