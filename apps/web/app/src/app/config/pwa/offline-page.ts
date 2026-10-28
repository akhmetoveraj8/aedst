import ar from "@/app/config/i18n/common/ar.json";
import en from "@/app/config/i18n/common/en.json";
import ru from "@/app/config/i18n/common/ru.json";
import tj from "@/app/config/i18n/common/tj.json";
import uz from "@/app/config/i18n/common/uz.json";
import { siteConfig } from "@/app/config/seo";
import {
  getLocaleDirection,
  type Locale,
  toLanguageTag,
} from "@/shared/i18n/locales";

/** Localized, script-free offline fallback document (see app/offline/[locale]/route.ts). */
const COMMON: Record<Locale, typeof en> = { en, ru, tj, uz, ar };

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function renderOfflinePage(locale: Locale): string {
  const t = COMMON[locale].offline;
  const { light, dark } = siteConfig.themeColor;
  return `<!doctype html>
<html lang="${toLanguageTag(locale)}" dir="${getLocaleDirection(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(t.title)} · ${escapeHtml(siteConfig.name)}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:${light};color:#171717}
@media (prefers-color-scheme:dark){:root{background:${dark};color:#fafafa}}
body{min-height:100vh;margin:0}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:1rem;text-align:center}
h1{font-size:1.5rem;margin:0}p{max-width:28rem;margin:0;opacity:.75}
a{padding:.5rem 1rem;border:1px solid currentColor;border-radius:.5rem;color:inherit;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(t.title)}</h1>
<p>${escapeHtml(t.description)}</p>
<a href="/${locale}">${escapeHtml(t.retry)}</a>
</main>
</body>
</html>`;
}
