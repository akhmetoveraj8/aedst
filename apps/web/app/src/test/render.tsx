import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactElement } from "react";

import commonMessages from "@/app/config/i18n/common/en.json";
import authMessages from "@/modules/auth/i18n/en.json";
import mediaMessages from "@/modules/media/i18n/en.json";
import notificationsMessages from "@/modules/notifications/i18n/en.json";
import searchMessages from "@/modules/search/i18n/en.json";
import tasksMessages from "@/modules/tasks/i18n/en.json";
import { AuthProvider } from "@/shared/lib/auth/auth-provider";
import type { Outbox } from "@/shared/lib/outbox/outbox";
import { OutboxContext } from "@/shared/lib/outbox/outbox-provider";
import {
  makeQueryClient,
  type QueryClientCallbacks,
} from "@/shared/lib/query-client";
import { backend } from "@/test/mocks/transport";

export const messages = {
  common: commonMessages,
  auth: authMessages,
  tasks: tasksMessages,
  search: searchMessages,
  notifications: notificationsMessages,
  media: mediaMessages,
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
  /** The offline outbox components see; none by default (queued writes then throw). */
  outbox?: Outbox | null;
};

/**
 * Renders with the same provider stack the real layout builds — i18n,
 * Connect transport (the in-memory router transport, see mocks/transport.ts), TanStack Query
 * (no retries, no stale time, so tests see real fetches deterministically),
 * URL state and auth — minus anything needing a running Next server.
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
    outbox = null,
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
      <NextIntlClientProvider locale="en" messages={messages}>
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
                <OutboxContext value={outbox}>{children}</OutboxContext>
              </AuthProvider>
            </NuqsTestingAdapter>
          </QueryClientProvider>
        </TransportProvider>
      </NextIntlClientProvider>
    ),
  });

  return { ...result, queryClient };
}
