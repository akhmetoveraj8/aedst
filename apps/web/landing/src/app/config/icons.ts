import type { Metadata } from "next";

/**
 * `<link rel="icon">` and `<link rel="apple-touch-icon">` for every page. iOS
 * ignores the manifest icons and, without this link, falls back to a page
 * screenshot for "Add to Home Screen". The PNG is rendered by
 * `app/icons/[file]/route.tsx` (180x180, full-bleed: iOS rounds the corners).
 */
export const appIcons = {
  icon: [{ url: "/favicon.ico", sizes: "any" }],
  apple: [
    {
      url: "/icons/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  ],
} satisfies NonNullable<Metadata["icons"]>;
