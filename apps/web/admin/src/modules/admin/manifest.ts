import { ADMIN_ROLE } from "@/shared/lib/auth/roles";
import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "admin",
  i18nNamespaces: ["admin"],
  routes: [{ path: "/admin", access: "session", requiredRole: ADMIN_ROLE }],
  nav: [
    { href: "/admin", labelKey: "admin", order: 90, requiredRole: ADMIN_ROLE },
  ],
  // Always on: the admin project exists only to serve this module (no capability gating).
  flagged: true,
  featureFlags: [],
  capabilities: [],
  permissions: [ADMIN_ROLE],
});
