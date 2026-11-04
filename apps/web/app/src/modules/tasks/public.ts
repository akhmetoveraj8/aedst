/**
 * Public surface of the module: the only code outside \`src/modules/<id>\`
 * may import (besides \`manifest.ts\`). Keep it to what pages and the app
 * shell compose; everything else is internal (enforced by
 * scripts/check-feature-boundaries.sh). Pages and layouts import the
 * single-export files in `entries/` instead: a Server Component importing
 * this barrel pulls the client chunks of every re-export into its route.
 */

export { loadTaskSearchParams } from "@/modules/tasks/lib/task-search-params";
export { CreateTaskPage } from "@/modules/tasks/ui/CreateTaskPage";
export { DashboardStatsFallback } from "@/modules/tasks/ui/DashboardStatsFallback";
export { DashboardStatsSection } from "@/modules/tasks/ui/DashboardStatsSection";
export { TaskDetailsFallback } from "@/modules/tasks/ui/TaskDetailsFallback";
export { TaskDetailsSection } from "@/modules/tasks/ui/TaskDetailsSection";
export { TaskListFallback } from "@/modules/tasks/ui/TaskListFallback";
export { TaskListSection } from "@/modules/tasks/ui/TaskListSection";
