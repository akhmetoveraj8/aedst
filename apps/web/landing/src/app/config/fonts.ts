import { Inter, Noto_Sans_Arabic } from "next/font/google";

/**
 * Self-hosted at build time by `next/font` (no runtime request to Google, no
 * layout shift). Inter covers Latin and Cyrillic locales (en, uz, ru, tj);
 * Arabic gets its own family with `preload: false` so other visitors never
 * download it.
 *
 * `subsets` only chooses what is PRELOADED: the `@font-face` rules of every
 * subset (latin-ext, cyrillic, cyrillic-ext) are always emitted with their
 * `unicode-range`, so the browser fetches a script's file when the page has
 * text in it. Preloading four subsets on every page cost 180 kB and competed
 * with the stylesheet for the first paint; Latin is the one file every locale
 * needs (brand name, digits, punctuation).
 */
export const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const fontArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
  preload: false,
});
