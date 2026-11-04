import path from "node:path";

/**
 * Module aliases shared by vite.config.ts and vitest.config.mts, so the app
 * and its tests resolve imports the same way.
 *
 * Order matters (first match wins): `@/shared/*` lives in ../shared (next to
 * the project, not under src/) and must win over the generic `@/*` -> src/*.
 *
 * - `@/shared/i18n/navigation` is next-intl's `createNavigation` for the Next
 *   projects; the SPA swaps in `src/app/i18n/navigation.tsx` (TanStack Router).
 * - `@sentry/nextjs` is what ../shared/lib/errors imports; the SPA runs on
 *   `@sentry/react` (same API surface for the calls the kit makes).
 */
export function adminAliases(root: string, { navigation = true } = {}) {
  const alias: { find: string | RegExp; replacement: string }[] = [];
  if (navigation) {
    alias.push({
      find: "@/shared/i18n/navigation",
      replacement: path.resolve(root, "src/app/i18n/navigation.tsx"),
    });
  }
  alias.push(
    {
      find: /^@\/shared\//,
      replacement: `${path.resolve(root, "../shared")}/`,
    },
    { find: /^@app\//, replacement: `${path.resolve(root, "src/app")}/` },
    { find: /^@\//, replacement: `${path.resolve(root, "src")}/` },
    { find: "@sentry/nextjs", replacement: "@sentry/react" },
  );
  return alias;
}
