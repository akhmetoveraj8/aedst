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

export { NotificationBellSection } from "@/modules/notifications/ui/NotificationBellSection";
export { NotificationPreferences } from "@/modules/notifications/ui/NotificationPreferences";
export { NotificationsInbox } from "@/modules/notifications/ui/NotificationsInbox";
