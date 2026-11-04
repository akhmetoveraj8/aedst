import { bufferEarlyErrors } from "@/app/config/sentry/early-errors";
import { loadSentry } from "@/app/config/sentry/loader";

/*
 * Sentry is not part of any route's first load: the SDK (error capture,
 * browser tracing, the `/monitoring` tunnel) is one same-origin lazy chunk,
 * requested right here before hydration starts, so it arrives in parallel
 * with the page instead of blocking it. Uncaught errors raised before it has
 * initialised are buffered and reported once it has; `reportError` calls in
 * that window (an error boundary catching during the very first render) are
 * the one thing the deferral can miss.
 */
const drainEarlyErrors = bufferEarlyErrors();

const sentry = loadSentry().then((client) => {
  for (const error of drainEarlyErrors()) {
    client?.captureEarlyError(error);
  }
  return client;
});

// Required by @sentry/nextjs to instrument App Router navigations; one that
// starts before the SDK has loaded is simply not traced.
export function onRouterTransitionStart(
  href: string,
  navigationType: string,
): void {
  void sentry.then((client) =>
    client?.captureRouterTransitionStart(href, navigationType),
  );
}
