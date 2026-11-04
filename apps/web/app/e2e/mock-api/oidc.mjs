// A tiny OpenID Connect provider for the Playwright suite, standing in for
// ZITADEL: discovery, an authorize endpoint with a login/registration form,
// the token endpoint (authorization_code + PKCE S256, rotating refresh_token),
// JWKS, revocation and RP-initiated logout. Tokens are real RS256 JWTs signed
// with the ephemeral key in ./jwt.mjs. Test-only: no real security properties.
import { createHash, randomUUID } from "node:crypto";

import {
  CLIENT_IDS,
  ISSUER,
  issueTokens,
  newUser,
  state,
  userById,
} from "./handlers.mjs";
import { jwks } from "./jwt.mjs";

/** code -> { userId, nonce, challenge, redirectUri } */
const codes = new Map();

const html = (strings, ...values) =>
  strings.reduce(
    (out, part, i) =>
      out + part + (i < values.length ? escapeHtml(values[i]) : ""),
    "",
  );

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => `&#${c.charCodeAt(0)};`,
  );
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

function tokenError(res, error, status = 400) {
  send(res, status, { error });
}

function authorizePage(params, error) {
  const registering = params.get("prompt") === "create";
  const hidden = [...params.entries()]
    .map(
      ([name, value]) =>
        html`<input type="hidden" name="${name}" value="${value}">`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock identity provider</title></head>
<body><main>
<h1>${registering ? "Create account" : "Mock identity provider"}</h1>
${error ? html`<p role="alert">${error}</p>` : ""}
<form method="post" action="/oidc/authorize">
${hidden}
<label>IdP email <input name="email" type="email" autocomplete="username"></label>
<label>IdP password <input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">${registering ? "Register" : "Continue"}</button>
</form></main></body></html>`;
}

function validAuthorizeRequest(params) {
  return (
    CLIENT_IDS.has(params.get("client_id") ?? "") &&
    params.get("response_type") === "code" &&
    params.get("code_challenge_method") === "S256" &&
    params.get("code_challenge") &&
    params.get("state") &&
    params.get("nonce") &&
    params.get("redirect_uri")?.startsWith("http://127.0.0.1:") &&
    params.get("scope")?.split(" ").includes("openid")
  );
}

function discovery() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/keys`,
    end_session_endpoint: `${ISSUER}/end_session`,
    revocation_endpoint: `${ISSUER}/revoke`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

function handleAuthorizePost(params, res) {
  if (!validAuthorizeRequest(params)) {
    return send(res, 400, "invalid authorization request", "text/plain");
  }
  const email = params.get("email") ?? "";
  const password = params.get("password") ?? "";
  const registering = params.get("prompt") === "create";

  let user = state.users.get(email);
  if (registering) {
    if (user)
      return send(
        res,
        200,
        authorizePage(params, "email already registered"),
        "text/html",
      );
    if (password.length < 8)
      return send(
        res,
        200,
        authorizePage(params, "password too short"),
        "text/html",
      );
    user = newUser({ email, password, tasks: 0 });
  } else if (!user || user.password !== password) {
    return send(
      res,
      200,
      authorizePage(params, "invalid credentials"),
      "text/html",
    );
  }

  const code = randomUUID();
  codes.set(code, {
    userId: user.id,
    nonce: params.get("nonce"),
    challenge: params.get("code_challenge"),
    redirectUri: params.get("redirect_uri"),
    clientId: params.get("client_id"),
  });
  const target = new URL(params.get("redirect_uri"));
  target.searchParams.set("code", code);
  target.searchParams.set("state", params.get("state"));
  target.searchParams.set("iss", ISSUER);
  return redirect(res, target.href);
}

async function handleToken(req, res) {
  const form = await readForm(req);
  const grant = form.get("grant_type");

  const clientId = form.get("client_id") ?? "";
  if (!CLIENT_IDS.has(clientId)) {
    return tokenError(res, "invalid_client", 401);
  }

  if (grant === "authorization_code") {
    const entry = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      !entry ||
      entry.clientId !== clientId ||
      entry.redirectUri !== form.get("redirect_uri") ||
      entry.challenge !== challenge
    ) {
      return tokenError(res, "invalid_grant");
    }
    const user = userById(entry.userId);
    return send(res, 200, issueTokens(user, { nonce: entry.nonce, clientId }));
  }

  if (grant === "refresh_token") {
    const token = form.get("refresh_token") ?? "";
    const user = userById(state.refreshTokens.get(token));
    if (!user) return tokenError(res, "invalid_grant");
    // Rotation: the presented token is single-use.
    state.refreshTokens.delete(token);
    return send(res, 200, issueTokens(user, { clientId }));
  }

  return tokenError(res, "unsupported_grant_type");
}

/** Returns true when the request belonged to the mock IdP. */
export async function handleOidc(req, res, url) {
  const path = url.pathname.slice("/oidc".length);

  if (req.method === "GET" && path === "/.well-known/openid-configuration") {
    send(res, 200, discovery());
  } else if (req.method === "GET" && path === "/keys") {
    send(res, 200, jwks());
  } else if (req.method === "GET" && path === "/authorize") {
    if (!validAuthorizeRequest(url.searchParams)) {
      send(res, 400, "invalid authorization request", "text/plain");
    } else {
      send(res, 200, authorizePage(url.searchParams), "text/html");
    }
  } else if (req.method === "POST" && path === "/authorize") {
    handleAuthorizePost(await readForm(req), res);
  } else if (req.method === "POST" && path === "/token") {
    await handleToken(req, res);
  } else if (req.method === "POST" && path === "/revoke") {
    const form = await readForm(req);
    state.refreshTokens.delete(form.get("token") ?? "");
    send(res, 200, {});
  } else if (req.method === "GET" && path === "/end_session") {
    const back = url.searchParams.get("post_logout_redirect_uri");
    if (back) redirect(res, back);
    else send(res, 200, "signed out", "text/plain");
  } else {
    send(res, 404, { error: "not_found" });
  }
}
