import {
  create,
  type DescMessage,
  type DescMethodUnary,
  fromJson,
  type JsonValue,
  type MessageInitShape,
  type MessageShape,
  toJson,
} from "@bufbuild/protobuf";

import type { RouteRegistration } from "./server";

/** Where server-side code (BFF route, server Connect transport) reaches apps/server. */
export const TEST_API_ORIGIN = "http://localhost:8080";

/**
 * apps/server mounts every service with WithRequireConnectProtocolHeader
 * (modulekit/mount.go): a unary call without `Connect-Protocol-Version: 1`
 * is refused. The mock refuses it too, so a hand-rolled client fails here.
 */
function rejectWithoutProtocolHeader(request: Request): Response | null {
  if (request.headers.get("connect-protocol-version") === "1") {
    return null;
  }
  return Response.json(
    {
      code: "invalid_argument",
      message: 'missing required header: set Connect-Protocol-Version to "1"',
    },
    { status: 400 },
  );
}

/**
 * Route declarations for SERVER-SIDE code only (the BFF route handler, the
 * server Connect transport), which builds its own `fetch` and cannot take an
 * injected transport. Apply with `server.use(rpcHandler(...))`
 * (./server.ts). Component tests do NOT use this: they use the in-memory
 * router transport in ./transport.ts.
 *
 * Speaks the Connect JSON protocol (`POST /<service>/<method>`) against
 * `origin` (default: apps/server's address).
 */
export function rpcHandler<I extends DescMessage, O extends DescMessage>(
  method: DescMethodUnary<I, O>,
  resolve: (
    input: MessageShape<I>,
    request: Request,
  ) => MessageInitShape<O> | Promise<MessageInitShape<O>>,
  origin: string = TEST_API_ORIGIN,
): RouteRegistration {
  return (routes) => {
    routes.set(
      `POST ${origin}/${method.parent.typeName}/${method.name}`,
      async (request) => {
        const rejected = rejectWithoutProtocolHeader(request);
        if (rejected) {
          return rejected;
        }
        const body = (await request.clone().json()) as JsonValue;
        const output = await resolve(fromJson(method.input, body), request);
        return Response.json(
          toJson(method.output, create(method.output, output)),
        );
      },
    );
  };
}

/** A Connect error response, e.g. `rpcErrorHandler(TasksService.method.getTask, "not_found", ...)`. */
export function rpcErrorHandler<I extends DescMessage, O extends DescMessage>(
  method: DescMethodUnary<I, O>,
  code: "unauthenticated" | "not_found" | "invalid_argument" | "internal",
  message: string,
  origin: string = TEST_API_ORIGIN,
): RouteRegistration {
  const status = {
    unauthenticated: 401,
    not_found: 404,
    invalid_argument: 400,
    internal: 500,
  }[code];

  return (routes) => {
    routes.set(`POST ${origin}/${method.parent.typeName}/${method.name}`, () =>
      Response.json({ code, message }, { status }),
    );
  };
}
