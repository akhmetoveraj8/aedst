import { notFound } from "next/navigation";

/**
 * Any unknown path under a locale. Without this catch-all Next answers with
 * its built-in 404 document, which skips the locale layout: no `lang`, no
 * `dir`, no header, untranslated text. `notFound()` here renders the
 * localized `[locale]/not-found.tsx` inside the layout instead.
 */
export default function CatchAllPage() {
  notFound();
}
