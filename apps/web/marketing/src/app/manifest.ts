import type { MetadataRoute } from "next";
import { siteConfig } from "@/app/config/seo";
import { defaultLocale } from "@/shared/i18n/locales";

/**
 * Plain web manifest for icons and theme colour. Deliberately NOT installable
 * (`display: browser`, no service worker): the installable PWA is the product
 * app, not the marketing site.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    lang: defaultLocale,
    dir: "auto",
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: siteConfig.themeColor.light,
    theme_color: siteConfig.themeColor.light,
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
