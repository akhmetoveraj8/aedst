import { clientEnv } from "@/shared/env/client";
import { sentryBaseOptions } from "@/shared/lib/errors/sentry-options";

/** Options for the browser SDK of this project. */
export const sentrySharedOptions = sentryBaseOptions({
  environment: clientEnv.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
});
