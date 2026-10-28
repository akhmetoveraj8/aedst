/**
 * Public surface of the module: the only code outside \`src/modules/<id>\`
 * may import (besides \`manifest.ts\`). Keep it to what pages and the app
 * shell compose; everything else is internal (enforced by
 * scripts/check-feature-boundaries.sh).
 *
 * The signed-in layouts import the single-export files in `entries/` instead of this
 * barrel (a Server Component importing a barrel pulls in the client chunks of
 * every re-export; see docs/content/web/architecture.md).
 */

export { AdminNav } from "@/modules/admin/ui/AdminNav";
export { AdminOverview } from "@/modules/admin/ui/AdminOverview";
export { AdminTasks } from "@/modules/admin/ui/AdminTasks";
export { AdminUsers } from "@/modules/admin/ui/AdminUsers";
export { AuditLog } from "@/modules/admin/ui/AuditLog";
export { BroadcastForm } from "@/modules/admin/ui/BroadcastForm";
