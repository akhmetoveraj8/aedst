import { defineModule } from "@/shared/modules/manifest";

// Embedded in other pages (task attachments); owns no route of its own.
export const manifest = defineModule({
  id: "media",
  i18nNamespaces: ["media"],
  routes: [],
  nav: [],
  featureFlags: ["client-image-compression"],
  capabilities: ["camera"],
  permissions: [],
});
