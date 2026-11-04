/**
 * Both the server transport (Server Components prefetching data) and the
 * browser transport carry this static key, so TanStack Query treats them as
 * the same transport in query keys — which is what lets a query prefetched
 * on the server be found by the client's `useQuery` after hydration.
 */

export const TRANSPORT_STATIC_KEY = "aedst-api";
