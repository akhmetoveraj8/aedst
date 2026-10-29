import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/app/shell/LocaleSwitcher";
import { PageMain } from "@/app/shell/PageMain";
import { AdminNav } from "@/modules/admin/entries/admin-nav";
import { ADMIN_SECTIONS } from "@/modules/admin/entries/admin-sections";
import { AdminSignOutButton } from "@/modules/admin/entries/admin-sign-out";
import { redirect } from "@/shared/i18n/navigation";
import { requireLocale } from "@/shared/i18n/require-locale";
import { can, isOperator } from "@/shared/lib/auth/roles";
import { getSessionRoles } from "@/shared/lib/auth/session";
import { ModeToggle } from "@/shared/ui/mode-toggle";

/**
 * Admin area. `proxy.ts` already redirects non-admins; this re-check keeps
 * the area closed even if the proxy matcher changes. Neither is the real
 * guard: apps/server's RoleInterceptor rejects every AdminService call
 * without the admin role.
 */
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]/admin">) {
  const locale = requireLocale((await params).locale);
  const roles = await getSessionRoles();
  if (!isOperator(roles)) {
    redirect({ href: "/forbidden", locale });
  }
  const allowed = ADMIN_SECTIONS.filter((section) =>
    can(roles, section.permission),
  ).map((section) => section.key);
  const t = await getTranslations({ locale, namespace: "admin" });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-2xl">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ModeToggle />
          <AdminSignOutButton />
        </div>
      </header>
      <AdminNav allowed={allowed} />
      <PageMain className="gap-4">{children}</PageMain>
    </div>
  );
}
