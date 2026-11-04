/** Keys under `marketing.*` in i18n/<locale>.json; the parity test checks they exist. */
export const featureKeys = [
  "offline",
  "fast",
  "accessible",
  "secure",
  "languages",
  "sync",
] as const;

export const stepKeys = ["create", "organize", "finish"] as const;

export const tierKeys = ["free", "pro", "team"] as const;

export const faqKeys = ["q1", "q2", "q3", "q4", "q5"] as const;
