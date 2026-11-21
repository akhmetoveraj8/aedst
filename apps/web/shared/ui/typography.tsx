import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/** shadcn/ui typography styles as one component; `variant` picks style and default tag. */
const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      h1: "scroll-m-20 text-4xl font-extrabold tracking-tight text-balance",
      h2: "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0",
      h3: "scroll-m-20 text-2xl font-semibold tracking-tight",
      h4: "scroll-m-20 text-xl font-semibold tracking-tight",
      p: "leading-7 not-first:mt-6",
      blockquote: "mt-6 border-s-2 ps-6 italic",
      list: "my-6 ms-6 list-disc [&>li]:mt-2",
      "inline-code":
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
      lead: "text-xl text-muted-foreground",
      large: "text-lg font-semibold",
      small: "text-sm leading-none font-medium",
      muted: "text-sm text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "p",
  },
});

type TypographyVariant = NonNullable<
  VariantProps<typeof typographyVariants>["variant"]
>;

const DEFAULT_TAG = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  p: "p",
  blockquote: "blockquote",
  list: "ul",
  "inline-code": "code",
  lead: "p",
  large: "div",
  small: "small",
  muted: "p",
} as const satisfies Record<
  TypographyVariant,
  keyof React.JSX.IntrinsicElements
>;

function Typography({
  className,
  variant,
  render,
  ...props
}: useRender.ComponentProps<"p"> & VariantProps<typeof typographyVariants>) {
  const resolved = variant ?? "p";
  return useRender({
    defaultTagName: DEFAULT_TAG[resolved],
    props: mergeProps<"p">(
      { className: cn(typographyVariants({ variant: resolved }), className) },
      props,
    ),
    render,
    state: { slot: "typography", variant: resolved },
  });
}

export { Typography, typographyVariants };
