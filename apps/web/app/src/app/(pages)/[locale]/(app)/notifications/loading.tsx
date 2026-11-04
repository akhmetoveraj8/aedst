import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";

// Shown instantly while this segment's server work starts, so navigating into
// it never shows a blank screen (the tasks segment has its own, richer one).
export default function SegmentLoading() {
  return <LoadingSkeleton className="h-64 w-full max-w-3xl" />;
}
