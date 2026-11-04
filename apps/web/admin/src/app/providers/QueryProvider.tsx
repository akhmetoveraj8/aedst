"use client";

import type { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { transport as browserTransport } from "@/shared/api/connect/client";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { type AppError, errorMessageKey } from "@/shared/lib/errors/app-error";
import { makeQueryClient } from "@/shared/lib/query-client";

/**
 * TanStack Query + the Connect transport for the admin panel. An expired
 * session restarts this project's own OIDC login (a full navigation to the
 * login Route Handler; with ZITADEL SSO it is usually seamless).
 */
export function QueryProvider({
  children,
  signInUrl,
  transport = browserTransport,
}: Readonly<{
  children: React.ReactNode;
  /** Login Route Handler URL carrying the post-login destination. */
  signInUrl: string;
  transport?: Transport;
}>) {
  const t = useTranslations("common.errors");
  const { isAuthenticated, signOut } = useAuth();

  // The QueryClient is created once, so its callbacks read the latest
  // translations through a ref instead of closing over stale ones.
  const handled = useRef(false);
  const handlers = useRef({
    onUnauthenticated: () => {},
    onUserFacingError: (_error: AppError) => {},
  });

  useEffect(() => {
    handlers.current = {
      onUnauthenticated: () => {
        // Many in-flight queries can fail at once; react to the first only.
        if (handled.current) {
          return;
        }
        handled.current = true;
        signOut();
        toast.error(t("sessionExpired"), { id: "app-error:session" });
        window.location.assign(signInUrl);
      },
      // One toast per kind of failure instead of one per failed request.
      onUserFacingError: (error) => {
        toast.error(t(errorMessageKey(error.kind)), {
          id: `app-error:${error.kind}`,
        });
      },
    };
  }, [signInUrl, signOut, t]);

  useEffect(() => {
    if (isAuthenticated) {
      handled.current = false;
    }
  }, [isAuthenticated]);

  const [queryClient] = useState(() =>
    makeQueryClient({
      onUnauthenticated: () => handlers.current.onUnauthenticated(),
      onUserFacingError: (error) => handlers.current.onUserFacingError(error),
    }),
  );

  return (
    <TransportProvider transport={transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportProvider>
  );
}
