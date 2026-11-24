/**
 * Public surface of the module: the only code outside `src/modules/<id>`
 * may import (besides `manifest.ts` and the single-export `entries/*`),
 * enforced by ../app/scripts/check-feature-boundaries.sh and
 * dependency-cruiser.
 */

export { legalSectionKeys } from "@/modules/legal/lib/section-keys";
export { LegalDocument } from "@/modules/legal/ui/legal-document";
