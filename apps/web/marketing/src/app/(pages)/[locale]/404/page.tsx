import { setRequestLocale } from "next-intl/server";
import { requireLocale } from "@/shared/i18n/require-locale";
import LocaleNotFound, { generateMetadata } from "../not-found";

export { generateMetadata };

/**
 * `/<locale>/404`, the document the static host serves for every unknown path
 * under a locale (nginx `error_page 404`, see deployments/nginx). A static
 * export cannot enumerate unknown URLs, so the catch-all route that used to
 * render the localized 404 inside the layout is replaced by this page. It is
 * not in the sitemap and carries `noindex` (see `../not-found.tsx`).
 */
export default async function NotFoundPage({
  params,
}: PageProps<"/[locale]/404">) {
  setRequestLocale(requireLocale((await params).locale));
  return <LocaleNotFound />;
}
