import { defineModule } from "@/shared/modules/manifest";

export const manifest = defineModule({
  id: "tasks",
  i18nNamespaces: ["tasks"],
  routes: [{ path: "/tasks", access: "session" }],
  nav: [{ href: "/tasks", labelKey: "tasks", order: 10 }],
  featureFlags: [],
  capabilities: [],
  permissions: [],
  outbox: ["task.create", "task.update"],
});
