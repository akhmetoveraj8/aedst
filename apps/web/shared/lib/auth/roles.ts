/**
 * Role names as apps/server's `AEDST_ROLE_POLICY` spells them
 * (`/aedst.admin.v1.AdminService/*=admin`). The web app only uses them to
 * decide what to render and which pages to route to; the server enforces
 * them on every RPC.
 *
 * The grants below mirror the built-in AdminService policy in
 * apps/server/internal/modules/admin/module/roles.go. Keep both in step.
 */
export const ADMIN_ROLE = "admin";
export const SUPPORT_ROLE = "support";
export const AUDITOR_ROLE = "auditor";

/** Every role that may open the admin area at all. */
export const OPERATOR_ROLES = [ADMIN_ROLE, SUPPORT_ROLE, AUDITOR_ROLE] as const;

export type AdminPermission =
  | "overview.read"
  | "users.read"
  | "tasks.read"
  | "tasks.delete"
  | "notifications.broadcast"
  | "audit.read";

const GRANTS: Record<AdminPermission, readonly string[]> = {
  "overview.read": [ADMIN_ROLE, SUPPORT_ROLE, AUDITOR_ROLE],
  "users.read": [ADMIN_ROLE, SUPPORT_ROLE],
  "tasks.read": [ADMIN_ROLE, SUPPORT_ROLE],
  "tasks.delete": [ADMIN_ROLE],
  "notifications.broadcast": [ADMIN_ROLE],
  "audit.read": [ADMIN_ROLE, AUDITOR_ROLE],
};

/** True when at least one of `roles` holds `permission`. UX only: the server decides. */
export function can(
  roles: readonly string[],
  permission: AdminPermission,
): boolean {
  return GRANTS[permission].some((role) => roles.includes(role));
}

/** True when `roles` holds any operator role (may enter the admin area). */
export function isOperator(roles: readonly string[]): boolean {
  return OPERATOR_ROLES.some((role) => roles.includes(role));
}
