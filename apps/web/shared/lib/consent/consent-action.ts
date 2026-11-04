"use server";

import { cookies, headers } from "next/headers";
import { isSecureSite } from "@/shared/lib/auth/session-cookies";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  isConsentChoice,
  isGlobalPrivacyControl,
  serializeConsent,
} from "@/shared/lib/consent/consent-cookie";

/**
 * Records the visitor's analytics choice (`granted` | `denied`) for a year.
 * A browser that sends Global Privacy Control is treated as having declined,
 * whatever the page asked to store.
 */
export async function saveConsentAction(choice: unknown): Promise<void> {
  if (!isConsentChoice(choice)) {
    return;
  }
  const effective = isGlobalPrivacyControl(await headers()) ? "denied" : choice;
  (await cookies()).set(CONSENT_COOKIE, serializeConsent(effective), {
    httpOnly: false,
    secure: isSecureSite,
    sameSite: "lax",
    path: "/",
    maxAge: CONSENT_MAX_AGE_SECONDS,
  });
}
