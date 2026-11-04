import type { Metadata } from "next";
import { clientEnv } from "@/shared/env/client";
import { defaultLocale, locales, toLanguageTag } from "@/shared/i18n/locales";
import type { AiCrawlerConfig } from "./ai-crawlers";

/**
 * Central SEO/branding constants. Everything metadata-related (root
 * metadata in the locale layout, sitemap.ts, robots.ts, llms.txt,
 * manifest.ts, opengraph-image.tsx, JSON-LD) reads from here instead of
 * hardcoding the app name or origin a second time. First-clone checklist:
 * docs/content/web/seo-geo.md.
 */
export const siteConfig = {
  name: "AEDST",
  // Fallback for surfaces that cannot use the translated `common.appDescription`
  // (the web manifest, llms.txt); every page's metadata reads the localized string.
  description: "A fast, accessible task manager built on the AEDST stack.",
  url: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
  // shadcn's neutral theme (see src/app/styles/globals.css) — pure
  // white/near-black, not a placeholder brand color.
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },
  // schema.org Organization entity (config/structured-data.ts). `logo` is a
  // path on this origin; `sameAs` lists the brand's official profiles
  // (GitHub org, LinkedIn, Wikipedia/Wikidata...). Empty until the owner
  // has real profiles: never invent them.
  organization: {
    legalName: "AEDST",
    logo: "/icons/icon-512.png",
    sameAs: [] as readonly string[],
  },
  // Which AI crawler groups robots.txt lets in (config/ai-crawlers.ts).
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
 * `hreflang` alternates for a locale-prefixed pathname (routing.localePrefix
 * is "always", so every locale — including the default — is prefixed).
 * `pathname` excludes the locale segment and any leading slash — `""` for
 * the home page, `"about"` for `/about`. (Not `"/"`/`"/about"`: `/en/` is
 * 308-redirected to `/en` by `proxy.ts` (config/trailing-slash.ts), so the
 * redirecting form is never generated.)
 */
export function buildLanguageAlternates(pathname: string) {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[toLanguageTag(locale)] = localizedUrl(locale, pathname);
  }
  // next-intl's `localeDetection` negotiates a locale for `/`, so an
  // x-default pointing at the default locale's URL is the closest
  // equivalent for crawlers that don't do content negotiation.
  languages["x-default"] = localizedUrl(defaultLocale, pathname);
  return languages;
}

/**
 * Metadata `alternates` for a PUBLIC page: a self-referencing canonical for
 * the current locale plus the hreflang set. Protected pages must not call
 * this: they are `noindex` and publish no alternates at all.
 */
export function buildAlternates(pathname: string, locale: string) {
  return {
    canonical: localizedUrl(locale, pathname),
    languages: buildLanguageAlternates(pathname),
  };
}

/**
 * Search-console ownership tokens as `metadata.verification`. Unset env =
 * no tag. Bing reads the `msvalidate.01` meta name.
 */
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
