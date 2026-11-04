import {
  DashboardStatsFallback,
  TaskListFallback,
} from "@/modules/tasks/public";

// Shown instantly while the tasks segment's server work starts — the
// segment-level counterpart of the per-section <Suspense> fallbacks in
// page.tsx, so navigating into /tasks never shows a blank screen.
export default function TasksLoading() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardStatsFallback />
      <TaskListFallback />
    </div>
  );
}
