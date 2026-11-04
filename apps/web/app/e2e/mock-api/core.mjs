// Shared building blocks of the in-memory mock API: errors, state, token
// issuing, auth guards, pagination. The per-service handlers live next to it.

import { signJwt } from "./jwt.mjs";

export const ACCESS_TTL_SECONDS = 900;
const PAGE_SIZE_MAX = 100;

/** Origin the mock is reachable at; presigned upload/download URLs point here. */
export const MOCK_ORIGIN = `http://127.0.0.1:${process.env.MOCK_API_PORT ?? 8181}`;

/** The mock identity provider (./oidc.mjs) lives under this issuer. */
export const ISSUER = `${MOCK_ORIGIN}/oidc`;
/**
 * The OIDC clients the mock IdP serves (one per web project) and the API's
 * audience (ZITADEL project id). CLIENT_ID is the default (the product app).
 */
export const CLIENT_ID = "aedst-web-e2e";
export const CLIENT_IDS = new Set([CLIENT_ID, "aedst-admin"]);
export const PROJECT_ID = "aedst-api-e2e";
/** ZITADEL's roles claim: { role: { orgId: orgDomain } }. */
export const ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

export class RpcError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const unauthenticated = (message = "missing or invalid token") =>
  new RpcError(401, "unauthenticated", message);
export const notFound = (what) =>
  new RpcError(404, "not_found", `${what} not found`);
export const invalid = (message) =>
  new RpcError(400, "invalid_argument", message);
export const forbidden = () =>
  new RpcError(403, "permission_denied", "admin role required");

export function createState() {
  return {
    /** email -> user */
    users: new Map(),
    /** access token -> userId */
    accessTokens: new Map(),
    /** refresh token -> userId */
    refreshTokens: new Map(),
    /** media id -> media record (incl. ownerId, bytes) */
    media: new Map(),
    /** push device id -> { userId, ... } */
    devices: new Map(),
    audit: [],
    sequence: 0,
  };
}

export const state = createState();

export function nextId() {
  state.sequence += 1;
  return `00000000-0000-4000-8000-${String(state.sequence).padStart(12, "0")}`;
}

/**
 * What the IdP's token endpoint issues: a real RS256 JWT access token (the
 * audience and ZITADEL-shaped roles claim apps/server would verify), an ID
 * token for the web app's client, and a rotating opaque refresh token.
 */
export function issueTokens(user, { nonce, clientId = CLIENT_ID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt({
    iss: ISSUER,
    sub: user.id,
    aud: [PROJECT_ID],
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
    jti: nextId(),
    [ROLES_CLAIM]: Object.fromEntries(
      user.roles.map((role) => [role, { "org-1": "mock.localhost" }]),
    ),
  });
  const idToken = signJwt({
    iss: ISSUER,
    sub: user.id,
    aud: [clientId],
    iat: now,
    exp: now + 600,
    ...(nonce ? { nonce } : {}),
    email: user.email,
    preferred_username: user.email,
    name: user.email.split("@")[0],
  });
  const refreshToken = `refresh-${nextId()}`;
  state.accessTokens.set(accessToken, user.id);
  state.refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
  };
}

export const STATUS = {
  TODO: "TASK_STATUS_TODO",
  IN_PROGRESS: "TASK_STATUS_IN_PROGRESS",
  DONE: "TASK_STATUS_DONE",
};
export const STATUS_NUMBER = {
  TASK_STATUS_TODO: 1,
  TASK_STATUS_IN_PROGRESS: 2,
  TASK_STATUS_DONE: 3,
};
export const PRIORITY = {
  LOW: "TASK_PRIORITY_LOW",
  MEDIUM: "TASK_PRIORITY_MEDIUM",
  HIGH: "TASK_PRIORITY_HIGH",
  URGENT: "TASK_PRIORITY_URGENT",
};

function seedTasks(userId, count) {
  const statuses = [STATUS.TODO, STATUS.IN_PROGRESS, STATUS.DONE];
  const priorities = Object.values(PRIORITY);
  const base = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const created = new Date(base + index * 60_000).toISOString();
    return {
      id: nextId(),
      title: `Seed task ${String(index + 1).padStart(2, "0")}`,
      description: "",
      status: statuses[index % 3],
      priority: priorities[index % 4],
      // Every 5th task is overdue and open; others have no due date.
      ...(index % 5 === 0 && statuses[index % 3] !== STATUS.DONE
        ? { dueDate: "2020-01-01T00:00:00Z" }
        : {}),
      createdAt: created,
      updatedAt: created,
      createdBy: userId,
      version: 1,
    };
  });
}

export function newUser({ email, password, roles = ["user"], tasks = 0 }) {
  const user = {
    id: nextId(),
    email,
    password,
    roles,
    tasks: [],
    notifications: [],
    preferences: {
      pushEnabled: true,
      taskCompleted: true,
      taskDueSoon: true,
      mediaReady: true,
    },
    createdAt: new Date().toISOString(),
  };
  user.tasks = seedTasks(user.id, tasks);
  state.users.set(email, user);
  return user;
}

export function userById(id) {
  return [...state.users.values()].find((candidate) => candidate.id === id);
}

export function authenticate(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = userById(state.accessTokens.get(token));
  if (!user) {
    throw unauthenticated();
  }
  return user;
}

export function requireAdmin(req) {
  const user = authenticate(req);
  if (!user.roles.includes("admin")) {
    throw forbidden();
  }
  return user;
}

export const iso = (date) => (date ? date : undefined);

export function publicTask(task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: iso(task.dueDate),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: iso(task.completedAt),
    createdBy: task.createdBy,
    version: task.version,
  };
}

export function findTask(user, id) {
  const task = user.tasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw notFound("task");
  }
  return task;
}

function decodePageToken(token) {
  if (!token) return 0;
  const offset = Number(Buffer.from(token, "base64url").toString().slice(2));
  return Number.isFinite(offset) ? offset : 0;
}

/** Offset paging behind opaque tokens, like the real keyset tokens. */
export function paginate(rows, body, defaultSize = 20, max = PAGE_SIZE_MAX) {
  const size = Math.min(body.pageSize || defaultSize, max);
  const offset = decodePageToken(body.pageToken);
  const next = offset + size;
  return {
    page: rows.slice(offset, offset + size),
    nextPageToken:
      next < rows.length ? Buffer.from(`o:${next}`).toString("base64url") : "",
  };
}

export function notify(
  user,
  { kind, title, body = "", link = "", subjectId = "" },
) {
  user.notifications.unshift({
    id: nextId(),
    kind,
    title,
    body,
    link,
    subjectId,
    createdAt: new Date().toISOString(),
  });
}
