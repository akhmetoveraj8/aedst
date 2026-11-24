import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "legal",
  i18nNamespaces: ["legal"],
  routes: [
    { path: "/privacy", access: "public" },
    { path: "/terms", access: "public" },
  ],
  nav: [],
  featureFlags: [],
  capabilities: [],
  permissions: [],
});
