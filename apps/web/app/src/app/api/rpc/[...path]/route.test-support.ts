/**
 * Harness shared by the `/api/rpc` route tests: the cookie jar `next/headers`
 * reads (mocked in each test file through `cookiesMock`) and a caller that
 * builds the browser's request. `./route` is imported lazily so the mock
 * factories that read this module never form an import cycle with it.
 */

export const jar = new Map<string, string>();

export const LIST = "aedst.tasks.v1.TasksService/ListTasks";

/** The `next/headers` module as the route sees it in tests. */
export const cookiesMock = {
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
};

export async function call(
  procedure: string,
  init: { origin?: string | null; headers?: Record<string, string> } = {},
) {
  const { POST } = await import("./route");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "connect-protocol-version": "1", // the browser transport always sends it
    host: "localhost:3000",
    ...init.headers,
  };
  if (init.origin !== null) {
    headers["origin"] = init.origin ?? "http://localhost:3000";
  }
  return POST(
    new Request(`http://localhost:3000/api/rpc/${procedure}`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    { params: Promise.resolve({ path: procedure.split("/") }) },
  );
}

export function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}
