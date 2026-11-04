import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "auth",
  i18nNamespaces: ["auth"],
  // The locale root is the sign-in landing page; the guard bounces signed-in
  // visitors from it to `?next=` or the tasks dashboard.
  routes: [{ path: "/", access: "public" }],
  nav: [],
  featureFlags: [],
  capabilities: [],
  permissions: [],
});
