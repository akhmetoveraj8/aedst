import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "search",
  i18nNamespaces: ["search"],
  routes: [{ path: "/search", access: "session" }],
  nav: [{ href: "/search", labelKey: "search", order: 20 }],
  featureFlags: ["command-palette"],
  capabilities: [],
  permissions: [],
});
