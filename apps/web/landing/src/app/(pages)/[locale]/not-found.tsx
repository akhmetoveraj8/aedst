import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/shared/i18n/navigation";
import { buttonVariants } from "@/shared/ui/button";

// `noindex` keeps soft-404 URLs out of search results.
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
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-medium text-muted-foreground text-sm">404</p>
      <h1 className="font-semibold text-2xl">{t("errors.notFoundTitle")}</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.notFoundDescription")}
      </p>
      <Link href="/" className={buttonVariants()}>
        {t("actions.goHome")}
      </Link>
    </div>
  );
}
