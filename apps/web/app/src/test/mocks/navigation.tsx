import type { ComponentProps } from "react";
import { vi } from "vitest";

/**
 * Stand-in for `@/shared/i18n/navigation` (next-intl's navigation, which
 * needs a mounted App Router). Registered globally in vitest.setup.ts; tests
 * assert on `routerMock` instead of mocking the module themselves.
 */
export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};

export const useRouter = () => routerMock;
export const usePathname = () => "/";
export const redirect = vi.fn();
export const getPathname = ({ href }: { href: string }) => href;

export function Link({ href, ...props }: ComponentProps<"a">) {
  return <a href={href} {...props} />;
}
