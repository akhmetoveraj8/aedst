import { Inter, Noto_Sans_Arabic } from "next/font/google";

/**
 * Self-hosted at build time by `next/font` (no runtime request to Google, no
 * layout shift). Inter covers Latin and Cyrillic locales (en, uz, ru, tj);
 * Arabic gets its own family with `preload: false` so other visitors never
 * download it.
 */
export const fontSans = Inter({
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const fontArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
  preload: false,
});
