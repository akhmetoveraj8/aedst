import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // layout and look
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
        // parts
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground",
        // variants
        "pointer-coarse:min-h-11 md:text-sm",
        // focus
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring",
        // invalid
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 focus-visible:aria-invalid:ring-destructive",
        // disabled
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
        // dark mode
        "dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:focus-visible:aria-invalid:ring-destructive",
        // reduced motion
        "motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
