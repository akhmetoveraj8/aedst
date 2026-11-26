import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactElement } from "react";
import { IntlProvider } from "use-intl";
import adminMessages from "@/shared/i18n/catalogs/admin/en.json";
import commonMessages from "@/shared/i18n/catalogs/admin-common/en.json";
import { AuthProvider } from "@/shared/lib/auth/auth-provider";
import {
  makeQueryClient,
  type QueryClientCallbacks,
} from "@/shared/lib/query-client";
import { backend } from "@/test/mocks/transport";

export const messages = {
  common: commonMessages,
  admin: adminMessages,
};

type Options = Omit<RenderOptions, "wrapper"> & {
  /** Initial URL search string for nuqs, e.g. `?status=done`. */
  searchParams?: string;
  initialUserId?: string | null;
  initialRoles?: string[];
  /** Keep prefetched/hydrated data fresh so no client refetch happens on mount. */
  staleTime?: number;
  callbacks?: QueryClientCallbacks;
  onUrlUpdate?: (event: { queryString: string }) => void;
};

/**
 * Renders with the provider stack the real layout builds (i18n, Connect
 * transport = the in-memory router transport in mocks/transport.ts, TanStack
 * Query without retries, URL state, auth) minus anything needing a running
 * server.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    searchParams = "",
    initialUserId = null,
    initialRoles,
    staleTime = 0,
    callbacks,
    onUrlUpdate,
    ...options
  }: Options = {},
) {
  const queryClient = makeQueryClient(callbacks);
  queryClient.setDefaultOptions({
    queries: { retry: false, staleTime, gcTime: Number.POSITIVE_INFINITY },
    mutations: { retry: false },
  });
  const transport = backend.transport;

  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <IntlProvider locale="en" messages={messages}>
        <TransportProvider transport={transport}>
          <QueryClientProvider client={queryClient}>
            <NuqsTestingAdapter
              hasMemory
              searchParams={searchParams}
              {...(onUrlUpdate ? { onUrlUpdate } : {})}
            >
              <AuthProvider
                initialUserId={initialUserId}
                initialRoles={initialRoles}
              >
                {children}
              </AuthProvider>
            </NuqsTestingAdapter>
          </QueryClientProvider>
        </TransportProvider>
      </IntlProvider>
    ),
  });

  return { ...result, queryClient };
}
