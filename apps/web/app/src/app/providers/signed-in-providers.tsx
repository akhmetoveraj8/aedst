import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";

import { AppOutboxProvider } from "@/app/providers/app-outbox-provider";
import { QueryProvider } from "@/app/providers/query-provider";

/**
 * Providers only the signed-in area uses: URL state (nuqs), server state
 * (TanStack Query over the Connect transport) and the offline outbox
 * (IndexedDB). Mounted by the `(app)` layout, not the root layout, so the
 * anonymous pages (sign-in, forbidden, not-found) do not download or start
 * any of it: about 55 KB gzip less first-load JavaScript on those routes.
 * Nothing outside `(app)` may call `useQuery`, `useQueryState` or the outbox.
 */
export function SignedInProviders({ children }: { children: ReactNode }) {
  return (
    <NuqsAdapter>
      <QueryProvider>
        <AppOutboxProvider>{children}</AppOutboxProvider>
      </QueryProvider>
    </NuqsAdapter>
  );
}
