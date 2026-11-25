import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { routeTree } from "@/app/routeTree.gen";

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
    // Hover/focus preloads the route chunk and runs its loader.
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
