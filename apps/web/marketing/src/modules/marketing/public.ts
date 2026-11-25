/**
 * Public surface of the module: the only code outside `src/modules/<id>`
 * may import (besides `manifest.ts`), enforced by
 * ../app/scripts/check-feature-boundaries.sh.
 *
 * Pages and layouts import the single-export files in `entries/` instead of
 * this barrel: the layout needs only the header and footer, and a Server
 * Component importing a barrel pulls the client chunks of every re-export
 * (the FAQ accordion) into its route.
 */

export { signInUrl } from "@/modules/marketing/lib/app-links";
export {
  faqKeys,
  featureKeys,
  stepKeys,
  tierKeys,
} from "@/modules/marketing/lib/content-keys";
export { CtaSection } from "@/modules/marketing/ui/cta-section";
export {
  FaqSection,
  getFaqEntries,
} from "@/modules/marketing/ui/faq-section";
export { Features } from "@/modules/marketing/ui/features";
export { Hero } from "@/modules/marketing/ui/hero";
export { HowItWorks } from "@/modules/marketing/ui/how-it-works";
export { Pricing } from "@/modules/marketing/ui/pricing";
export { SiteFooter } from "@/modules/marketing/ui/site-footer";
export { SiteHeader } from "@/modules/marketing/ui/site-header";
