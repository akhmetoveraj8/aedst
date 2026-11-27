import { cn } from "cn";

/**
 * One decorative placeholder block (no semantics). To announce loading to
 * assistive technology wrap placeholders in `LoadingSkeleton`; for an inline
 * wait indicator use `Spinner`.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
