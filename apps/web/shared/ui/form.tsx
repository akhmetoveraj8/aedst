import { cn } from "cn";
import type * as React from "react";

/**
 * The one place a raw `<form>` element lives (Biome `noRestrictedElements`
 * forbids it in modules and the app). Pair it with React Hook Form's
 * `handleSubmit`; `scripts/check-forms.mjs` fails when a file renders a form
 * without importing `react-hook-form`.
 */
function Form({ className, ...props }: React.ComponentProps<"form">) {
  return <form data-slot="form" className={cn(className)} {...props} />;
}

export { Form };
