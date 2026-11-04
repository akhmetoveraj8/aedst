import createMiddleware from "next-intl/middleware";
import { routing } from "@/shared/i18n/routing";

// Locale negotiation only (`/` -> `/<locale>`). No auth, no CSP nonce: pages
// stay statically rendered and the CSP is a static header (next.config.ts).
export default createMiddleware(routing);

export const config = {
  // Skip Next internals and every path with a file extension (robots.txt,
  // sitemap.xml, llms.txt, manifest.webmanifest, favicon.ico, icons/*.png).
  matcher: ["/((?!_next|.*..*).*)"],
};
