import { locales, toLanguageTag } from "@/shared/i18n/locales";
import { publicRoutes } from "./public-routes";
import { siteConfig } from "./seo";

/**
 * Body of /llms.txt (llmstxt.org format: H1, blockquote summary, H2 sections
 * of links), built from `siteConfig` and the public route table so it cannot
 * drift from the sitemap. Documentation has its own llms.txt on the docs site.
 */
export function buildLlmsTxt(): string {
  const pages = publicRoutes.flatMap((route) =>
    locales.map((locale) => {
      const url = new URL(
        `/${locale}${route.pathname ? `/${route.pathname}` : ""}`,
        siteConfig.url,
      ).toString();
      return `- [${route.label} (${toLanguageTag(locale)})](${url})`;
    }),
  );
  const machine = [
    ["Sitemap", "/sitemap.xml"],
    ["Robots policy", "/robots.txt"],
  ].map(
    ([label, path]) =>
      `- [${label}](${new URL(path as string, siteConfig.url).toString()})`,
  );

  return [
    `# ${siteConfig.name}`,
    "",
    `> ${siteConfig.description}`,
    "",
    "Signed-in areas (tasks, search, notifications) are per-user and not indexable.",
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
