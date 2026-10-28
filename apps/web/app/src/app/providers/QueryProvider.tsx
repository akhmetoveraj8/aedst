"use client";

import type { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { transport as browserTransport } from "@/shared/api/connect/client";
import { isDevelopment } from "@/shared/env/client";
import { useRouter } from "@/shared/i18n/navigation";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { type AppError, errorMessageKey } from "@/shared/lib/errors/app-error";
import { makeQueryClient } from "@/shared/lib/query-client";

// Loaded on demand and only in development: production bundles never include
// the devtools chunk, and dev bundles do not pay for it on first load.
const ReactQueryDevtools = isDevelopment
  ? dynamic(
      () =>
        import("@tanstack/react-query-devtools").then(
          (mod) => mod.ReactQueryDevtools,
        ),
      { ssr: false },
    )
  : () => null;

export function QueryProvider({
  children,
  transport = browserTransport,
}: Readonly<{
  children: React.ReactNode;
  transport?: Transport;
}>) {
  const t = useTranslations("common.errors");
  const router = useRouter();
  const { isAuthenticated, signOut } = useAuth();

  // The QueryClient is created once, so its callbacks read the latest
  // translations/router through a ref instead of closing over stale ones.
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
        const here = `${window.location.pathname}${window.location.search}`;
        const withoutLocale = here.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "/";
        router.replace(`/?next=${encodeURIComponent(withoutLocale)}`);
      },
      // One toast per kind of failure: ten requests failing at once while
      // offline update the same toast instead of stacking ten.
      onUserFacingError: (error) => {
        toast.error(t(errorMessageKey(error.kind)), {
          id: `app-error:${error.kind}`,
        });
      },
    };
  }, [router, signOut, t]);

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
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="bottom-right"
          position="bottom"
          theme="system"
        />
      </QueryClientProvider>
    </TransportProvider>
  );
}
