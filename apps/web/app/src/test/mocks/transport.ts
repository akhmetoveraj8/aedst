import type {
  DescMessage,
  DescMethodUnary,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createRouterTransport,
  type HandlerContext,
  type ServiceImpl,
} from "@connectrpc/connect";
import { addStaticKeyToTransport } from "@connectrpc/connect-query";

import { MediaService } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { NotificationsService } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { SearchService } from "@/shared/api/connect/generated/aedst/search/v1/search_pb";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { TRANSPORT_STATIC_KEY } from "@/shared/api/connect/transport-key";

const SERVICES = [
  MediaService,
  NotificationsService,
  SearchService,
  TasksService,
] as const;

type AnyHandler = (input: unknown, context: HandlerContext) => unknown;

/** Resolves one unary RPC; may return the response init shape or throw a `ConnectError`. */
export type RpcResolver<I extends DescMessage, O extends DescMessage> = (
  input: MessageShape<I>,
  context: HandlerContext,
) => MessageInitShape<O> | Promise<MessageInitShape<O>>;

/** A declaration applied with `backend.use(...)`; build one with `rpc()` / `rpcError()`. */
export type MockRpc = (target: {
  handle: MockBackend["handle"];
  fail: MockBackend["fail"];
}) => void;

type MockBackend = ReturnType<typeof createMockBackend>;

/** `backend.use(rpc(TasksService.method.getTask, () => ({ task })))`: typed in and out. */
export function rpc<I extends DescMessage, O extends DescMessage>(
  method: DescMethodUnary<I, O>,
  resolve: RpcResolver<I, O>,
): MockRpc {
  return (target) => target.handle(method, resolve);
}

/** `backend.use(rpcError(TasksService.method.getTask, Code.NotFound, "gone"))`. */
export function rpcError<I extends DescMessage, O extends DescMessage>(
  method: DescMethodUnary<I, O>,
  code: Code,
  message: string,
): MockRpc {
  return (target) => target.fail(method, code, message);
}

const methodKey = (method: DescMethodUnary) =>
  `${method.parent.typeName}/${method.name}`;

/**
 * In-memory Connect backend for component tests. Uses `createRouterTransport`
 * from @connectrpc/connect, so the real generated client, real (de)serialization
 * and TanStack Query run end to end with no network and no service worker, and
 * both the resolver input and the response are fully typed from the proto
 * descriptors. A call nobody declared a resolver for is recorded in `unhandled`
 * and answered with `unimplemented`; vitest.setup.ts fails the test on it.
 */
function createMockBackend() {
  const handlers = new Map<string, AnyHandler>();
  const requests: Array<{ method: string; input: unknown }> = [];
  const unhandled: string[] = [];

  const transport = createRouterTransport((router) => {
    for (const service of SERVICES) {
      const impl: Record<string, AnyHandler> = {};
      for (const method of service.methods) {
        const key = `${service.typeName}/${method.name}`;
        impl[method.localName] = async (input, context) => {
          requests.push({ method: key, input });
          const handler = handlers.get(key);
          if (!handler) {
            unhandled.push(key);
            throw new ConnectError(
              `no mock registered for ${key}`,
              Code.Unimplemented,
            );
          }
          return await handler(input, context);
        };
      }
      router.service(service, impl as unknown as ServiceImpl<typeof service>);
    }
  });

  return {
    /** Same shape as the app's browser transport (static key => shared query keys). */
    transport: addStaticKeyToTransport(transport, TRANSPORT_STATIC_KEY),
    /** Every RPC the code under test made, in order. */
    requests,
    unhandled,

    /** Declares how one RPC answers. A later declaration replaces an earlier one. */
    handle<I extends DescMessage, O extends DescMessage>(
      method: DescMethodUnary<I, O>,
      resolve: RpcResolver<I, O>,
    ) {
      handlers.set(methodKey(method), resolve as AnyHandler);
    },

    /** Declares that one RPC fails with the given Connect code. */
    fail<I extends DescMessage, O extends DescMessage>(
      method: DescMethodUnary<I, O>,
      code: Code,
      message: string,
    ) {
      handlers.set(methodKey(method), () => {
        throw new ConnectError(message, code);
      });
    },

    /** Applies declarations made with `rpc()` / `rpcError()`. */
    use(...mocks: MockRpc[]) {
      for (const mock of mocks) {
        mock(this);
      }
    },

    /** Inputs received by one RPC, in order. */
    inputsOf<I extends DescMessage, O extends DescMessage>(
      method: DescMethodUnary<I, O>,
    ): MessageShape<I>[] {
      const key = methodKey(method);
      return requests
        .filter((request) => request.method === key)
        .map((request) => request.input as MessageShape<I>);
    },

    reset() {
      handlers.clear();
      requests.length = 0;
      unhandled.length = 0;
    },
  };
}

/** Shared per-test backend; reset after each test in vitest.setup.ts. */
export const backend = createMockBackend();

export { Code };
