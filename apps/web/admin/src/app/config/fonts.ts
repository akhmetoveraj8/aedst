import { Geist_Mono, Inter, Noto_Sans_Arabic } from "next/font/google";

/**
 * Self-hosted at build time by `next/font` (no runtime request to Google, no
 * layout shift: the fallback is metric-adjusted). Inter covers the Latin and
 * Cyrillic locales (en, uz, ru, tj); Arabic gets its own family, which is
 * `preload: false` so non-Arabic visitors never download it — the browser
 * only fetches it when Arabic glyphs actually appear.
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

export const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
});
