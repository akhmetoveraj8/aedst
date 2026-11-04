import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { Skeleton } from "@/shared/ui/skeleton";

export function DashboardStatsFallback() {
  return (
    <LoadingSkeleton className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </LoadingSkeleton>
  );
}
