/** An unsigned JWT-shaped string — enough for code that only reads `exp`/`sub`. */

export function fakeJwt({
  sub = "user-1",
  expiresInSeconds,
}: {
  sub?: string;
  expiresInSeconds: number;
}): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode({
    sub,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })}.signature`;
}
