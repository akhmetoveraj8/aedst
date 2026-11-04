import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageMain } from "@/app/shell/PageMain";
import { Link } from "@/shared/i18n/navigation";
import { requireLocale } from "@/shared/i18n/require-locale";
import { buttonVariants } from "@/shared/ui/button";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/forbidden">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: t("errors.forbiddenTitle"),
    robots: { index: false, follow: false },
  };
}

/** Where `proxy.ts` sends a signed-in user who lacks a page's role. */
export default async function ForbiddenPage({
  params,
}: PageProps<"/[locale]/forbidden">) {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });
  return (
    <PageMain className="items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-medium text-muted-foreground text-sm">403</p>
      <h1 className="font-semibold text-2xl">{t("errors.forbiddenTitle")}</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.forbiddenDescription")}
      </p>
      <Link href="/tasks" className={buttonVariants()}>
        {t("nav.tasks")}
      </Link>
    </PageMain>
  );
}
