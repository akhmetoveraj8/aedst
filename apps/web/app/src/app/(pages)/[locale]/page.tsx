import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/app/config/JsonLd";
import { buildAlternates } from "@/app/config/seo";
import { graph, webApplication } from "@/app/config/structured-data";
import { PrivacySettingsButton } from "@/app/providers/PrivacySettingsButton";
import { LocaleSwitcherLazy } from "@/app/shell/LocaleSwitcherLazy";
import { PageMain } from "@/app/shell/PageMain";
import { AuthGate } from "@/modules/auth/public";
import { toLanguageTag } from "@/shared/i18n/locales";
import { requireLocale } from "@/shared/i18n/require-locale";
import { parseAuthError } from "@/shared/lib/auth/auth-errors";
import { safeRedirectPath } from "@/shared/lib/auth/safe-redirect";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: "auth.login" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return {
    // Composed explicitly, not via the layout's `title.template`: per
    // Next's metadata docs, a layout's template only applies to *nested*
    // segments, never to a page in the same segment as the layout that
    // defines it — and this page is a direct child of
    // `(pages)/[locale]/layout.tsx`. The template still exists for when a
    // real nested route (e.g. `[locale]/settings`) ships.
    title: `${t("title")} · ${tCommon("appName")}`,
    description: tCommon("appDescription"),
    alternates: buildAlternates("", locale),
  };
}

export default async function LocaleRootPage({
  params,
  searchParams,
}: PageProps<"/[locale]">) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);

  const [tCommon, query] = await Promise.all([
    getTranslations({ locale, namespace: "common" }),
    searchParams,
  ]);
  // `proxy.ts` puts the page the visitor was headed to in `?next=`; validated
  // here too, so a crafted link cannot turn sign-in into an open redirect.
  const next = typeof query.next === "string" ? query.next : undefined;

  const authError = parseAuthError(
    typeof query.auth_error === "string" ? query.auth_error : undefined,
  );

  return (
    <>
      <JsonLd
        data={graph(
          webApplication({
            locale,
            inLanguage: toLanguageTag(locale),
            name: tCommon("appName"),
            description: tCommon("appDescription"),
          }),
        )}
      />
      <PageMain className="mx-auto w-full max-w-sm justify-center gap-6 p-6">
        <div className="flex justify-end">
          <LocaleSwitcherLazy />
        </div>
        <header className="flex flex-col gap-2">
          <h1 className="font-semibold text-3xl tracking-tight">
            {tCommon("appName")}
          </h1>
          <p className="text-muted-foreground">{tCommon("appDescription")}</p>
        </header>

        <AuthGate
          redirectTo={next ? safeRedirectPath(next) : undefined}
          error={authError}
        />
        <PrivacySettingsButton className="self-start text-muted-foreground" />
      </PageMain>
    </>
  );
}
