import { getTranslations } from "next-intl/server";

import { getSessionIdentity } from "@/shared/lib/auth/session";

/**
 * Server Component: who is signed in, read from the ID token in the httpOnly
 * session cookie — no API call, so the name is in the streamed HTML. Display
 * only (the token is not verified here); authorization is apps/server's.
 */
export async function CurrentUser() {
  const identity = await getSessionIdentity();
  const who = identity?.email ?? identity?.username ?? identity?.name;
  if (!who) {
    return null;
  }
  const t = await getTranslations("auth");
  return (
    <p className="text-muted-foreground text-sm">
      {t("signedInAs", { email: who })}
    </p>
  );
}
