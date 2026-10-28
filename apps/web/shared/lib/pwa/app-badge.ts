/**
 * Badging API (installed PWA icon badge). A no-op where the API does not
 * exist (non-installed pages, Firefox, older Safari) and never throws: the
 * badge is a hint, not a feature a flow may depend on.
 * `navigator` is `WorkerNavigator` inside the service worker, `Navigator` on
 * the page; both carry the same two methods in browsers that ship them.
 */

type BadgingNavigator = {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function badging(): BadgingNavigator | null {
  return typeof navigator === "undefined"
    ? null
    : (navigator as unknown as BadgingNavigator);
}

/** Shows `count` on the app icon, or the plain dot when `count` is omitted. Zero clears. */
export async function setAppBadge(count?: number): Promise<void> {
  const nav = badging();
  try {
    if (count === 0) {
      await nav?.clearAppBadge?.();
    } else {
      await nav?.setAppBadge?.(count);
    }
  } catch {
    // Permission not granted or API disabled: ignore.
  }
}

export async function clearAppBadge(): Promise<void> {
  try {
    await badging()?.clearAppBadge?.();
  } catch {
    // See setAppBadge.
  }
}
