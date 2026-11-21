import { TransportProvider } from "@connectrpc/connect-query";
import type { Decorator } from "@storybook/nextjs-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { useState } from "react";

import commonMessages from "@/app/config/i18n/common/en.json";
import authMessages from "@/modules/auth/i18n/en.json";
import mediaMessages from "@/modules/media/i18n/en.json";
import notificationsMessages from "@/modules/notifications/i18n/en.json";
import searchMessages from "@/modules/search/i18n/en.json";
import tasksMessages from "@/modules/tasks/i18n/en.json";
import { AuthProvider } from "@/shared/lib/auth/auth-provider";
import { makeQueryClient } from "@/shared/lib/query-client";
import { backend, type MockRpc } from "@/test/mocks/transport";

const messages = {
  common: commonMessages,
  auth: authMessages,
  tasks: tasksMessages,
  search: searchMessages,
  notifications: notificationsMessages,
  media: mediaMessages,
};

/**
 * Story parameters read below: `rpc` (MockRpc[]: what the backend answers),
 * `searchParams` (initial nuqs URL string, e.g. `?q=docs`), `roles` (default a plain user).
 */

/**
 * Wraps a composite module screen in the same provider stack the app builds
 * (i18n, Connect transport, TanStack Query, URL state, auth), backed by the
 * in-memory typed transport of the component tests (`src/test/mocks/transport.ts`)
 * - no network, no service worker. A story declares what the backend answers
 * with `parameters.rpc`; a call it does not declare fails with `unimplemented`.
 */
export const withAppProviders: Decorator = (Story, context) => {
  const [queryClient] = useState(() => {
    backend.reset();
    backend.use(...((context.parameters.rpc as MockRpc[] | undefined) ?? []));
    const client = makeQueryClient();
    client.setDefaultOptions({
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    });
    return client;
  });

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <TransportProvider transport={backend.transport}>
        <QueryClientProvider client={queryClient}>
          <NuqsTestingAdapter
            hasMemory
            searchParams={context.parameters.searchParams ?? ""}
          >
            <AuthProvider
              initialUserId="story-user"
              initialRoles={context.parameters.roles ?? ["user"]}
            >
              <Story />
            </AuthProvider>
          </NuqsTestingAdapter>
        </QueryClientProvider>
      </TransportProvider>
    </NextIntlClientProvider>
  );
};
