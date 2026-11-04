import { afterEach, beforeEach } from "vitest";
import { server } from "./src/test/mocks/server";

// Node-side tests (route handlers, proxy.ts, the server Connect transport)
// reach apps/server through the global `fetch`. It is replaced by a stub that
// only answers routes a test declared with `rpcHandler`/`rpcErrorHandler`
// (src/test/mocks/connect.ts) and fails loudly on anything else. Code that
// talks to the IdP takes an injected `fetch` instead (src/test/mocks/oidc.ts).
beforeEach(() => {
  server.listen();
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});
