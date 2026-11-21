import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { Skeleton } from "@/shared/ui/skeleton";

export function TaskListFallback() {
  return (
    <LoadingSkeleton className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full max-w-xs" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </LoadingSkeleton>
  );
}
