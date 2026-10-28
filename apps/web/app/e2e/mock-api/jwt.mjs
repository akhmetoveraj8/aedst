// Ephemeral RS256 signing for the mock identity provider. The key pair is
// generated per mock-server process and never leaves it; the public half is
// served at /oidc/keys like a real IdP's JWKS. node:crypto only.
import { createSign, generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

export const KEY_ID = "mock-key-1";

const b64url = (value) =>
  Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");

export function signJwt(claims) {
  const signingInput = `${b64url({ alg: "RS256", typ: "JWT", kid: KEY_ID })}.${b64url(claims)}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

export function jwks() {
  return {
    keys: [
      {
        ...publicKey.export({ format: "jwk" }),
        kid: KEY_ID,
        use: "sig",
        alg: "RS256",
      },
    ],
  };
}
