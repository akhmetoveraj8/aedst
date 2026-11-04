import { renderOfflinePage } from "@/app/config/pwa/offline-page";
import { type Locale, locales } from "@/shared/i18n/locales";

/**
 * The service worker's navigation fallback (precached per locale): shown
 * when a page cannot be fetched because the device is offline. A static,
 * script-free document on purpose — it carries no session data (it is the
 * same for every visitor, so it is safe to cache), needs no CSP nonce, and
 * renders even when the app's JS chunks are not cached. Lives outside
 * `[locale]` (and `proxy.ts`'s matcher) so it is never locale-redirected.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/offline/[locale]">,
) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(renderOfflinePage(locale as Locale), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}
