import type { Metadata } from "next";
import { clientEnv } from "@/env";
import {
  defaultLocale,
  type Locale,
  locales,
  toLanguageTag,
} from "@/shared/i18n/locales";
import type { AiCrawlerConfig } from "@/shared/lib/seo/ai-crawlers";

/**
 * Central SEO/branding constants for the marketing site. Metadata, sitemap,
 * robots, llms.txt, manifest, OG image and JSON-LD all read from here instead
 * of hardcoding the name or origin a second time. Rules: docs/content/web/seo-geo.md.
 */
export const siteConfig = {
  name: "AEDST",
  // Fallback for surfaces that cannot use translated copy (manifest, llms.txt).
  // Pages read the localized `common.appDescription`.
  description:
    "AEDST helps teams plan, track and finish tasks in a fast, accessible app that works offline in five languages.",
  url: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
  // shadcn's neutral theme (see src/app/styles/globals.css).
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },
  // schema.org Organization. `sameAs` lists official profiles only; leave it
  // empty until the owner has real ones (never invent them).
  organization: {
    legalName: "AEDST",
    logo: "/icons/icon-512.png",
    sameAs: [] as readonly string[],
  },
  // Default: be citable (answer engines), do not feed model training.
  aiCrawlers: {
    answerEngines: "allow",
    trainingCrawlers: "deny",
  } as AiCrawlerConfig,
} as const;

function localizedUrl(locale: string, pathname: string): string {
  const suffix = pathname ? `/${pathname}` : "";
  return new URL(`/${locale}${suffix}`, siteConfig.url).toString();
}

/**
 * `hreflang` alternates for a locale-prefixed pathname (localePrefix is
 * "always"). `pathname` excludes the locale segment and any leading slash:
 * `""` for home, `"privacy"` for `/privacy`.
 */
export function buildLanguageAlternates(pathname: string) {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[toLanguageTag(locale)] = localizedUrl(locale, pathname);
  }
  languages["x-default"] = localizedUrl(defaultLocale, pathname);
  return languages;
}

/** Self-referencing canonical for the current locale plus the hreflang set. */
export function buildAlternates(pathname: string, locale: string) {
  return {
    canonical: localizedUrl(locale, pathname),
    languages: buildLanguageAlternates(pathname),
  };
}

/**
 * Open Graph block for one page. A page that sets `openGraph` replaces the
 * layout's block as a whole, so every public page calls this: `og:url` must be
 * the page's own canonical, never the locale root.
 */
export function buildOpenGraph(
  pathname: string,
  locale: Locale,
  text: { siteName: string; title: string; description: string },
): NonNullable<Metadata["openGraph"]> {
  return {
    type: "website",
    siteName: text.siteName,
    title: text.title,
    description: text.description,
    locale: toLanguageTag(locale),
    url: localizedUrl(locale, pathname),
  };
}

/** Search-console ownership tokens as `metadata.verification`; unset = no tag. */
export function buildVerification(): Metadata["verification"] | undefined {
  const google = clientEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
  const bing = clientEnv.NEXT_PUBLIC_BING_SITE_VERIFICATION;
  if (!(google || bing)) {
    return undefined;
  }
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
