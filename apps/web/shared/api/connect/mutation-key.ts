import type { DescMethodUnary } from "@bufbuild/protobuf";
import { createConnectQueryKey } from "@connectrpc/connect-query";

/**
 * `mutationKey` for a mutation of one RPC. connect-query's `useMutation` sets
 * none, and the MutationCache hooks (query-client.ts) read the procedure from
 * this key for Sentry's `rpc.procedure` tag and the mutation breadcrumb. Use it
 * on every mutation, including ones that wrap the call in the outbox.
 */
export function mutationKeyFor(method: DescMethodUnary) {
  return createConnectQueryKey({ schema: method, cardinality: undefined });
}
