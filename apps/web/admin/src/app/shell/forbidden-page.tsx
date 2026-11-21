import { useLocale, useTranslations } from "use-intl";

import { adminEnv } from "@/app/config/env";
import { PageMain } from "@/app/shell/page-main";
import { buttonVariants } from "@/shared/ui/button";

/** Where a signed-in user without an operator role (or a failed sign-in) lands. */
export function ForbiddenPage() {
  const t = useTranslations("common");
  const locale = useLocale();
  return (
    <PageMain className="items-center justify-center gap-4 px-4 py-24 text-center">
      <title>{t("errors.forbiddenTitle")}</title>
      <p className="font-medium text-muted-foreground text-sm">403</p>
      <h1 className="font-semibold text-2xl">{t("errors.forbiddenTitle")}</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {t("errors.forbiddenDescription")}
      </p>
      {/* The product app is another origin, so a plain anchor, not the router Link. */}
      <a
        href={new URL(`/${locale}`, adminEnv.VITE_APP_URL).toString()}
        className={buttonVariants()}
      >
        {t("actions.goHome")}
      </a>
    </PageMain>
  );
}
