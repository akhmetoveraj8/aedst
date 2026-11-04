import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { assertOperator } from "@/app/auth/guards";
import { LocaleSwitcher } from "@/app/shell/LocaleSwitcher";
import { PageMain } from "@/app/shell/PageMain";
import { AdminNav } from "@/modules/admin/entries/admin-nav";
import { ADMIN_SECTIONS } from "@/modules/admin/entries/admin-sections";
import { AdminSignOutButton } from "@/modules/admin/entries/admin-sign-out";
import { can } from "@/shared/lib/auth/roles";
import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { ModeToggle } from "@/shared/ui/mode-toggle";

/**
 * Admin area. The root route already sent anonymous visitors to sign in; this
 * keeps the area closed to signed-in users without an operator role. Neither
 * is the real guard: the BFF guards the HTML and apps/server's RoleInterceptor
 * rejects every AdminService call without the right role.
 */
export const Route = createFileRoute("/$locale/admin")({
  beforeLoad: ({ context }) => {
    assertOperator(context.session?.roles ?? [], context.locale);
  },
  component: AdminLayout,
  pendingComponent: SegmentLoading,
});

function SegmentLoading() {
  return <LoadingSkeleton className="h-64 w-full max-w-3xl" />;
}

function AdminLayout() {
  const { session } = Route.useRouteContext();
  const t = useTranslations("admin");
  const roles = session?.roles ?? [];
  const allowed = ADMIN_SECTIONS.filter((section) =>
    can(roles, section.permission),
  ).map((section) => section.key);
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
      <PageMain className="gap-4">
        <Outlet />
      </PageMain>
    </div>
  );
}
