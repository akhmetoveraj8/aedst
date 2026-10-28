import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSentryServer } = await import("@/app/config/sentry/server");
    initSentryServer();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { initSentryEdge } = await import("@/app/config/sentry/edge");
    initSentryEdge();
  }
}

export const onRequestError = Sentry.captureRequestError;
