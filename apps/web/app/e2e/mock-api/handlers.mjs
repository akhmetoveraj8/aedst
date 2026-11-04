// In-memory stand-in for apps/server's ConnectRPC services, shared by the
// Playwright mock server (./server.mjs) and the contract test
// (src/test/contract/mock-api.contract.test.ts), which checks every
// procedure here against the generated protobuf descriptors.
//
// Handlers take the Connect JSON request body and return the JSON response
// body (protobuf JSON mapping: camelCase fields, enum names, int64 as
// strings, RFC 3339 timestamps). Errors are `RpcError`s carrying the Connect
// code and its HTTP status.

import { admin } from "./admin.mjs";
import { capabilities } from "./capabilities.mjs";
import {
  ACCESS_TTL_SECONDS,
  CLIENT_ID,
  CLIENT_IDS,
  createState,
  ISSUER,
  issueTokens,
  MOCK_ORIGIN,
  newUser,
  notFound,
  notify,
  PROJECT_ID,
  ROLES_CLAIM,
  RpcError,
  state,
  userById,
} from "./core.mjs";
import { media } from "./media.mjs";
import { notifications } from "./notifications.mjs";
import { search } from "./search.mjs";
import { tasks } from "./tasks.mjs";

export {
  ACCESS_TTL_SECONDS,
  CLIENT_ID,
  CLIENT_IDS,
  createState,
  ISSUER,
  issueTokens,
  MOCK_ORIGIN,
  newUser,
  PROJECT_ID,
  ROLES_CLAIM,
  RpcError,
  state,
  userById,
};

/** Every mocked Connect service, keyed by fully-qualified service name. */
export const services = {
  "aedst.tasks.v1.TasksService": tasks,
  "aedst.search.v1.SearchService": search,
  "aedst.notifications.v1.NotificationsService": notifications,
  "aedst.media.v1.MediaService": media,
  "aedst.admin.v1.AdminService": admin,
  "aedst.capabilities.v1.CapabilitiesService": capabilities,
};

/** Test control plane — never exposed by the real server. */
export const control = {
  // Creates an isolated user with `tasks` seeded tasks (and optional roles,
  // e.g. ["user", "admin"], and seeded notifications).
  "/__test/seed"(body) {
    const user = newUser({
      email: body.email,
      password: body.password ?? "password123",
      roles: body.roles ?? ["user"],
      tasks: body.tasks ?? 25,
    });
    for (let i = 0; i < (body.notifications ?? 0); i += 1) {
      notify(user, {
        kind: "NOTIFICATION_KIND_SYSTEM",
        title: `Seed notification ${i + 1}`,
        body: "Hello from the mock API",
        link: "/tasks",
      });
    }
    return { email: user.email, password: user.password, userId: user.id };
  },
  // Every access token of the user stops working; refresh tokens still do —
  // simulates an access token expiring while the session lives on.
  "/__test/expire-access"(body) {
    const user = state.users.get(body.email);
    for (const [token, userId] of state.accessTokens) {
      if (userId === user?.id) state.accessTokens.delete(token);
    }
    return {};
  },
  // A valid access token for a seeded user, without going through the IdP's
  // browser flow (used by the contract test).
  "/__test/token"(body) {
    const user = state.users.get(body.email);
    if (!user) throw notFound("user");
    return { accessToken: issueTokens(user).access_token };
  },
  // Everything is revoked — simulates a session ended server-side.
  "/__test/revoke-session"(body) {
    const user = state.users.get(body.email);
    for (const map of [state.accessTokens, state.refreshTokens]) {
      for (const [token, userId] of map) {
        if (userId === user?.id) map.delete(token);
      }
    }
    return {};
  },
};

/** Presigned-URL stand-in: PUT stores the object, GET serves it. */
export function storeObject(id, bytes) {
  const record = state.media.get(id);
  if (!record) return false;
  record.bytes = bytes;
  return true;
}

export function readObject(id) {
  const record = state.media.get(id);
  return record?.bytes
    ? { bytes: record.bytes, type: record.contentType }
    : null;
}
