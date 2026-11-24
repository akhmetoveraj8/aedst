import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "marketing",
  i18nNamespaces: ["marketing"],
  routes: [{ path: "/", access: "public" }],
  nav: [],
  featureFlags: [],
  capabilities: [],
  permissions: [],
});
