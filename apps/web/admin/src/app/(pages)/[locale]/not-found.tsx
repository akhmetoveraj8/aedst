import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageMain } from "@/app/shell/PageMain";

import { Link } from "@/shared/i18n/navigation";
import { buttonVariants } from "@/shared/ui/button";

// Without a title, assistive tech announces the raw URL and axe flags
// `document-title`; `noindex` keeps soft-404 URLs out of search results.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("errors.notFoundTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function LocaleNotFound() {
  const t = await getTranslations("common");

  return (
    <PageMain className="items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold text-foreground">
        {t("errors.notFoundTitle")}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("errors.notFoundDescription")}
      </p>
      <Link href="/" className={buttonVariants()}>
        {t("actions.goHome")}
      </Link>
    </PageMain>
  );
}
