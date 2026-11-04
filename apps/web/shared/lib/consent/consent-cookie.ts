export type ConsentState = "unknown" | "granted" | "denied";
export type ConsentChoice = Exclude<ConsentState, "unknown">;

/** What is persisted: the answer, which wording/policy it answered, and when. */
export type ConsentRecord = {
  version: number;
  choice: ConsentChoice;
  /** ISO-8601 time of the answer; empty for a migrated pre-versioning cookie. */
  at: string;
};

/**
 * Consent lives in a plain (non-httpOnly) first-party cookie rather than
 * `localStorage` so the *server* can read it: the banner is then rendered in
 * the first HTML only for visitors who have not answered — no flash for those
 * who have, and no client-only banner popping in after hydration (which
 * would also become the page's Largest Contentful Paint element).
 *
 * Value: JSON `{version, choice, at}`. Raise `CONSENT_VERSION` when what
 * measurement does changes materially; older answers then count as unknown
 * and the visitor is asked again.
 */
export const CONSENT_COOKIE = "aedst_consent";
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const CONSENT_VERSION = 1;

export function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === "granted" || value === "denied";
}

export function serializeConsent(
  choice: ConsentChoice,
  now: Date = new Date(),
): string {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    choice,
    at: now.toISOString(),
  };
  return JSON.stringify(record);
}

/** Reads the cookie value, also accepting the legacy bare `granted`/`denied`. */
export function parseConsentRecord(
  value: string | undefined,
): ConsentRecord | null {
  if (!value) {
    return null;
  }
  if (isConsentChoice(value)) {
    return { version: CONSENT_VERSION, choice: value, at: "" };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "choice" in parsed &&
      "version" in parsed &&
      isConsentChoice(parsed.choice) &&
      typeof parsed.version === "number"
    ) {
      return {
        version: parsed.version,
        choice: parsed.choice,
        at: "at" in parsed && typeof parsed.at === "string" ? parsed.at : "",
      };
    }
  } catch {
    // Not JSON: treated as no answer.
  }
  return null;
}

export function parseConsent(value: string | undefined): ConsentState {
  const record = parseConsentRecord(value);
  return record && record.version >= CONSENT_VERSION
    ? record.choice
    : "unknown";
}

/** Global Privacy Control sent by the browser as `Sec-GPC: 1`. */
export function isGlobalPrivacyControl(headers: {
  get(name: string): string | null;
}): boolean {
  return headers.get("sec-gpc")?.trim() === "1";
}
