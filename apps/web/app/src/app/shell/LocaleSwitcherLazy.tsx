"use client";

import dynamic from "next/dynamic";

/**
 * The language picker pulls in the whole Select popup stack (about 48 KB gzip)
 * that most routes do not otherwise ship, so it loads after hydration instead
 * of counting toward first load. The placeholder reserves the trigger's size
 * so the header does not shift when it arrives.
 */
export const LocaleSwitcherLazy = dynamic(
  () => import("@/app/shell/LocaleSwitcher").then((m) => m.LocaleSwitcher),
  {
    ssr: false,
    loading: () => <div aria-hidden className="h-7 w-28" />,
  },
);
