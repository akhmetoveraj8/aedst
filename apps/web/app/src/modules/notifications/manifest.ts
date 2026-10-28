import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "notifications",
  i18nNamespaces: ["notifications"],
  routes: [{ path: "/notifications", access: "session" }],
  nav: [{ href: "/notifications", labelKey: "notifications", order: 30 }],
  featureFlags: [],
  capabilities: ["push", "service-worker"],
  permissions: [],
});
