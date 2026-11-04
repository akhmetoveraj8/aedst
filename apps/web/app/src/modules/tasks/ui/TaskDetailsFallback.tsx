import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";

export function TaskDetailsFallback() {
  return <LoadingSkeleton className="h-64 w-full max-w-lg" />;
}
