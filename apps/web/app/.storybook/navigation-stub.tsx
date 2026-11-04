import type { ComponentProps } from "react";

/**
 * Stand-in for `@/shared/i18n/navigation` in Storybook (aliased in main.ts):
 * next-intl's navigation needs a mounted App Router, which a story does not
 * have. Navigation does nothing here; the component tests assert on it with
 * `src/test/mocks/navigation.tsx` instead.
 */
const noop = () => undefined;

export const useRouter = () => ({
  push: noop,
  replace: noop,
  refresh: noop,
  back: noop,
  forward: noop,
  prefetch: noop,
});
export const usePathname = () => "/";
export const redirect = noop;
export const getPathname = ({ href }: { href: string }) => href;

export function Link({ href, ...props }: ComponentProps<"a">) {
  return <a href={href} {...props} />;
}
