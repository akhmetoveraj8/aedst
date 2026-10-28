#!/usr/bin/env node
// A small in-memory stand-in for apps/server's ConnectRPC API, used only by
// the Playwright suite so flows behind authentication (login, refresh,
// dashboard, filters, pagination, CRUD, search, notifications, uploads,
// admin) run in CI without Postgres or Go.
//
// It speaks the Connect unary JSON protocol (`POST /<service>/<method>`,
// errors as `{code, message}` with the matching HTTP status) — the same wire
// format apps/web's generated client and BFF proxy use against the real
// server. The procedures live in ./handlers.mjs, which the contract test
// (src/test/contract/) checks against the generated protobuf descriptors.
//
// It also plays the identity provider (./oidc.mjs, issuer /oidc): the web
// app signs in with OpenID Connect Authorization Code + PKCE against it, and
// the API tokens it issues are real RS256 JWTs.
//
// Test-only control endpoints live under `/__test/*` so each test can seed an
// isolated user (parallel-safe) and force token expiry/revocation, and
// `/__storage/<id>` plays object storage for presigned uploads.
import { createServer } from "node:http";

import {
  control,
  RpcError,
  readObject,
  services,
  storeObject,
} from "./handlers.mjs";
import { handleOidc } from "./oidc.mjs";

const PORT = Number(process.env.MOCK_API_PORT ?? 8181);
const STORAGE_PREFIX = "/__storage/";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = (await readBody(req)).toString();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new RpcError(400, "invalid_argument", "invalid JSON");
  }
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Object storage is cross-origin to the app, like S3: answer CORS. */
function corsHeaders(req) {
  return {
    "access-control-allow-origin": req.headers.origin ?? "*",
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };
}

async function handleStorage(req, res, id) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }
  if (req.method === "PUT") {
    const ok = storeObject(id, await readBody(req));
    res.writeHead(ok ? 200 : 404, headers);
    return res.end();
  }
  if (req.method === "GET") {
    const object = readObject(id);
    if (!object) {
      res.writeHead(404, headers);
      return res.end();
    }
    res.writeHead(200, {
      ...headers,
      "content-type": object.type,
      "cross-origin-resource-policy": "cross-origin",
    });
    return res.end(object.bytes);
  }
  res.writeHead(405, headers);
  return res.end();
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://mock");
    if (url.pathname === "/__test/health") {
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith(STORAGE_PREFIX)) {
      return await handleStorage(
        req,
        res,
        url.pathname.slice(STORAGE_PREFIX.length),
      );
    }
    if (url.pathname.startsWith("/oidc/")) {
      return await handleOidc(req, res, url);
    }
    if (req.method !== "POST") {
      throw new RpcError(405, "unimplemented", "POST only");
    }
    const body = await readJson(req);

    const controlHandler = control[url.pathname];
    if (controlHandler) {
      return send(res, 200, controlHandler(body));
    }

    // apps/server mounts services with WithRequireConnectProtocolHeader
    // (modulekit/mount.go): a unary call without the header is refused.
    if (req.headers["connect-protocol-version"] !== "1") {
      throw new RpcError(
        400,
        "invalid_argument",
        'missing required header: set Connect-Protocol-Version to "1"',
      );
    }

    const [, service, method] = url.pathname.split("/");
    const handler = services[service]?.[method];
    if (!handler) {
      throw new RpcError(404, "unimplemented", `unknown ${url.pathname}`);
    }
    return send(res, 200, handler(body, req));
  } catch (error) {
    if (error instanceof RpcError) {
      return send(res, error.status, {
        code: error.code,
        message: error.message,
      });
    }
    console.error(error);
    return send(res, 500, { code: "internal", message: "mock server error" });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`mock API listening on http://127.0.0.1:${PORT}`);
});
