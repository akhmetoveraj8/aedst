import { addStaticKeyToTransport } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";

import { AdminService } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { MediaService } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { NotificationsService } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { SearchService } from "@/shared/api/connect/generated/aedst/search/v1/search_pb";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { TRANSPORT_STATIC_KEY } from "@/shared/api/connect/transport-key";

/**
 * The browser never talks to apps/server directly: every call goes to this
 * app's own `/api/rpc` route (backend-for-frontend), which attaches the
 * bearer token from the httpOnly session cookie and refreshes it when it
 * expires. That is what keeps tokens out of page JavaScript — and why no
 * `Authorization` interceptor, token storage, CORS or cross-origin
 * `connect-src` exists on this side.
 */
/** Browser-side deadline per call (sent as connect-timeout-ms, enforced locally). */
export const BROWSER_TIMEOUT_MS = 20_000;

export const RPC_BASE_PATH = "/api/rpc";

export function createBrowserTransport(baseUrl: string = RPC_BASE_PATH) {
  return addStaticKeyToTransport(
    createConnectTransport({ baseUrl, defaultTimeoutMs: BROWSER_TIMEOUT_MS }),
    TRANSPORT_STATIC_KEY,
  );
}

export const transport = createBrowserTransport();

// Re-exported so callers using `@connectrpc/connect-query`'s `useQuery` /
// `useMutation` (which take a method descriptor, e.g. `TasksService.method.listTasks`)
// don't need their own import path into `generated/`.
export {
  AdminService,
  MediaService,
  NotificationsService,
  SearchService,
  TasksService,
};
