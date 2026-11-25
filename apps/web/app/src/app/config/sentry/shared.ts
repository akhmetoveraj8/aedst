import { clientEnv } from "@/shared/env/client";
import { sentryBaseOptions } from "@/shared/lib/errors/sentry-options";

/** Options shared by the browser, Node and Edge SDKs of this project. */
export const sentrySharedOptions = sentryBaseOptions({
  environment:
    clientEnv.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV,
});
