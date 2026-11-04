/**
 * Holds uncaught errors and unhandled rejections raised before the lazily
 * loaded Sentry SDK has initialised (see instrumentation-client.ts), so they
 * are still reported once it has. This is what Sentry's own Loader Script
 * does; that script is served from Sentry's CDN, which the CSP does not allow
 * (third-party script origin), hence this small same-origin equivalent.
 *
 * Returns `drain`: it stops listening and hands back what was caught.
 */
export function bufferEarlyErrors(target: Window = window): () => unknown[] {
  const caught: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    caught.push(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    caught.push(event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    return caught.splice(0);
  };
}
