import { cn } from "cn";

/**
 * The page's one `<main>` landmark and the target of the skip link
 * (`#main-content`). Every route renders exactly one: the signed-in shell puts
 * it after its `<header>` so the header stays a top-level banner landmark,
 * public pages and error screens render it as their outermost element.
 */
export function PageMain({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn("flex flex-1 flex-col outline-none", className)}
    >
      {children}
    </main>
  );
}
