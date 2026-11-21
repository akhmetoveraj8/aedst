/**
 * Public surface of the module: the only code outside \`src/modules/<id>\`
 * may import (besides \`manifest.ts\`). Keep it to what pages and the app
 * shell compose; everything else is internal (enforced by
 * scripts/check-feature-boundaries.sh). Pages and layouts import the
 * single-export files in `entries/` instead: a Server Component importing
 * this barrel pulls the client chunks of every re-export into its route.
 */

export { CreateTaskPage } from "@/modules/tasks/features/create/ui/create-task-page";
export { DashboardStatsFallback } from "@/modules/tasks/features/dashboard/ui/dashboard-stats-fallback";
export { DashboardStatsSection } from "@/modules/tasks/features/dashboard/ui/dashboard-stats-section";
export { TaskDetailsFallback } from "@/modules/tasks/features/details/ui/task-details-fallback";
export { TaskDetailsSection } from "@/modules/tasks/features/details/ui/task-details-section";
export { loadTaskSearchParams } from "@/modules/tasks/features/list/lib/task-search-params";
export { TaskListFallback } from "@/modules/tasks/features/list/ui/task-list-fallback";
export { TaskListSection } from "@/modules/tasks/features/list/ui/task-list-section";
