import { useTranslations } from "next-intl";

import type { AuthErrorCode } from "@/shared/lib/auth/auth-errors";
import { buttonVariants } from "@/shared/ui/button";

const LOGIN_PATH = "/api/auth/login";

function loginHref(redirectTo: string | undefined, register: boolean) {
  const params = new URLSearchParams();
  if (redirectTo) {
    params.set("next", redirectTo);
  }
  if (register) {
    params.set("screen_hint", "register");
  }
  const query = params.toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}

/**
 * The locale root page's content for a signed-out visitor: sign in (or create an
 * account) with the identity provider. Both are plain links to the OIDC
 * Route Handler, so they work before hydration and without JavaScript.
 * Signed-in visitors never reach it — `proxy.ts` redirects them first.
 */
export function AuthGate({
  redirectTo,
  error,
}: {
  redirectTo?: string;
  error?: AuthErrorCode;
}) {
  const t = useTranslations("auth.login");

  return (
    <section className="flex w-full max-w-sm flex-col gap-3">
      <h2 className="font-medium text-lg">{t("title")}</h2>
      <p className="text-muted-foreground text-sm">{t("description")}</p>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${error}`)}
        </p>
      )}

      {/* A document navigation, never client-side routing: it leaves the app. */}
      <a href={loginHref(redirectTo, false)} className={buttonVariants()}>
        {t("submit")}
      </a>

      <p className="text-muted-foreground text-sm">
        {t("switchPrompt")}{" "}
        <a
          href={loginHref(redirectTo, true)}
          className={buttonVariants({
            variant: "link",
            className: "h-auto p-0 font-medium",
          })}
        >
          {t("switchAction")}
        </a>
      </p>
    </section>
  );
}
