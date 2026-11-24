import { clientEnv } from "@/env";

/**
 * Links into the signed-in product app (a separate origin, never hard-coded).
 * The app serves its sign-in page at its locale root and starts registration
 * through its BFF login route (`screen_hint=register`).
 */
export function signInUrl(locale: string): string {
  return new URL(`/${locale}`, clientEnv.NEXT_PUBLIC_APP_URL).toString();
}

export function registerUrl(): string {
  return new URL(
    "/api/auth/login?screen_hint=register",
    clientEnv.NEXT_PUBLIC_APP_URL,
  ).toString();
}
