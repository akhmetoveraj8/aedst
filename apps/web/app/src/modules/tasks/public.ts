/**
 * Public surface of the module: the only code outside \`src/modules/<id>\`
 * may import (besides \`manifest.ts\`). Keep it to what pages and the app
 * shell compose; everything else is internal (enforced by
 * scripts/check-feature-boundaries.sh).
 */

export { loadTaskSearchParams } from "@/modules/tasks/lib/task-search-params";
export { CreateTaskPage } from "@/modules/tasks/ui/CreateTaskPage";
export {
  DashboardStatsFallback,
  DashboardStatsSection,
  TaskDetailsFallback,
  TaskDetailsSection,
  TaskListFallback,
  TaskListSection,
} from "@/modules/tasks/ui/TasksSections";
