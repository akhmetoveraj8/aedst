import "server-only";

import type {
  DescMessage,
  DescMethodUnary,
  MessageInitShape,
} from "@bufbuild/protobuf";
import { createQueryOptions } from "@connectrpc/connect-query";
import { dehydrate } from "@tanstack/react-query";

import { getServerTransport } from "@/shared/api/connect/server";
import { makeQueryClient } from "@/shared/lib/query-client";

/**
 * The reference pattern for server data in this app: a Server Component
 * prefetches into a request-scoped `QueryClient`, `dehydrate()`s it, and
 * wraps the client component in `<HydrationBoundary state={...}>`. The
 * client's `useQuery` then finds the data already in its cache (same key —
 * see `TRANSPORT_STATIC_KEY`), so first paint has content and no waterfall,
 * while refetch/invalidate/mutations keep working client-side.
 *
 * Each call site gets its own client so a `<Suspense>`-wrapped section only
 * ships (and only waits for) its own queries.
 */
export function createRpcPrefetcher() {
  const queryClient = makeQueryClient();
  const transport = getServerTransport();

  return {
    /**
     * A failed prefetch is deliberately swallowed (`prefetchQuery` never
     * throws): it is simply absent from the dehydrated state, and the client
     * refetches and renders its own error/unauthenticated handling.
     */
    async prefetch<I extends DescMessage, O extends DescMessage>(
      schema: DescMethodUnary<I, O>,
      input: MessageInitShape<I>,
    ): Promise<void> {
      await queryClient.prefetchQuery(
        createQueryOptions(schema, input, { transport }),
      );
    },
    dehydrate: () => dehydrate(queryClient),
  };
}
