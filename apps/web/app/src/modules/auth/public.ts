/**
 * Public surface of the module: the only code outside \`src/modules/<id>\`
 * may import (besides \`manifest.ts\`). Keep it to what pages and the app
 * shell compose; everything else is internal (enforced by
 * scripts/check-feature-boundaries.sh).
 */

export { AuthGate } from "@/modules/auth/ui/AuthGate";
export { CurrentUser } from "@/modules/auth/ui/CurrentUser";
export { SignOutButton } from "@/modules/auth/ui/SignOutButton";
