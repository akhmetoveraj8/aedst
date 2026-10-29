import type { Locale } from "@/shared/i18n/locales";
import { redirect } from "@/shared/i18n/navigation";
import { type AdminPermission, can } from "@/shared/lib/auth/roles";
import { getSessionRoles } from "@/shared/lib/auth/session";

/**
 * Page-level permission gate for a Server Component: sends a signed-in
 * operator who lacks `permission` to the forbidden page. UX only; the
 * RoleInterceptor in apps/server rejects the RPC regardless.
 */
export async function requirePermission(
  locale: Locale,
  permission: AdminPermission,
): Promise<void> {
  if (!can(await getSessionRoles(), permission)) {
    redirect({ href: "/forbidden", locale });
  }
}
