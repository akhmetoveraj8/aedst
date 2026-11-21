/**
 * Public surface of the module: the only code outside \`src/modules/<id>\`
 * may import (besides \`manifest.ts\`). Keep it to what pages and the app
 * shell compose; everything else is internal (enforced by
 * scripts/check-feature-boundaries.sh).
 */

export { AuthGate } from "@/modules/auth/ui/auth-gate";
export { CurrentUser } from "@/modules/auth/ui/current-user";
export { SignOutButton } from "@/modules/auth/ui/sign-out-button";
