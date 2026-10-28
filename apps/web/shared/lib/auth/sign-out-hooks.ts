/**
 * Work that must happen *before* the session cookies are cleared, while
 * authenticated calls still succeed — e.g. the notifications module
 * unregistering this browser's push subscription, so the next person who
 * signs in on this device does not receive the previous user's pushes.
 * Feature modules register here instead of the auth module importing them
 * (modules never import each other).
 */
type SignOutHook = () => Promise<void> | void;

const hooks = new Set<SignOutHook>();

export function registerBeforeSignOut(hook: SignOutHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

/** Runs every hook, best effort, never longer than `timeoutMs`. */
export async function runBeforeSignOut(timeoutMs = 1_500): Promise<void> {
  const all = Promise.allSettled([...hooks].map(async (hook) => hook()));
  await Promise.race([
    all,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
