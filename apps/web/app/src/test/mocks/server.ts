import { vi } from "vitest";

type RouteHandler = (request: Request) => Response | Promise<Response>;

/** What `rpcHandler`/`rpcErrorHandler` return; applied by `server.use(...)`. */
export type RouteRegistration = (routes: Map<string, RouteHandler>) => void;

const routes = new Map<string, RouteHandler>();

/**
 * A tiny stand-in for the network for Node-side tests: while listening, the
 * global `fetch` answers only the `POST <origin>/<procedure>` routes tests
 * declared and throws for anything else, so an unexpected call fails the test
 * instead of reaching a socket. (Replaces MSW: the only thing it was needed
 * for was these Connect JSON POSTs.)
 */
export const server = {
  use(...registrations: RouteRegistration[]) {
    for (const register of registrations) {
      register(routes);
    }
  },
  listen() {
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        const { origin, pathname } = new URL(request.url);
        const handler = routes.get(`${request.method} ${origin}${pathname}`);
        if (!handler) {
          throw new Error(
            `unhandled request: ${request.method} ${origin}${pathname}`,
          );
        }
        return await handler(request);
      },
    );
  },
  resetHandlers() {
    routes.clear();
  },
  close() {
    vi.unstubAllGlobals();
  },
};
