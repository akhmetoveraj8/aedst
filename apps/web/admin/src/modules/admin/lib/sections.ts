import type { AdminPermission } from "@/shared/lib/auth/roles";

/** Sections of the admin panel and the permission each one needs (UX only; the server enforces). */
export const ADMIN_SECTIONS = [
  { href: "/admin", key: "overview", permission: "overview.read" },
  { href: "/admin/users", key: "users", permission: "users.read" },
  { href: "/admin/tasks", key: "tasks", permission: "tasks.read" },
  {
    href: "/admin/broadcast",
    key: "broadcast",
    permission: "notifications.broadcast",
  },
  { href: "/admin/audit", key: "audit", permission: "audit.read" },
] as const satisfies readonly {
  href: string;
  key: string;
  permission: AdminPermission;
}[];
