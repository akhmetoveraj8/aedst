import { useTranslations } from "use-intl";
import { PageMain } from "@/app/shell/PageMain";
import { Link } from "@/shared/i18n/navigation";
import { buttonVariants } from "@/shared/ui/button";

export function LocaleNotFound() {
  const t = useTranslations("common");

  return (
    <PageMain className="items-center justify-center gap-4 px-4 py-24 text-center">
      <title>{t("errors.notFoundTitle")}</title>
      <p className="font-medium text-muted-foreground text-sm">404</p>
      <h1 className="font-semibold text-2xl text-foreground">
        {t("errors.notFoundTitle")}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.notFoundDescription")}
      </p>
      <Link href="/" className={buttonVariants()}>
        {t("actions.goHome")}
      </Link>
    </PageMain>
  );
}
