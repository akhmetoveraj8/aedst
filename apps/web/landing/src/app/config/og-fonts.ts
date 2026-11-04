import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fonts for `next/og` (satori). Satori's built-in font is Latin only, so the
 * Cyrillic (ru, tj) and Arabic (ar) cards need real glyphs. satori reads
 * ttf/otf/woff but NOT woff2, hence the `.woff` files of the OFL-licensed
 * @fontsource packages. Several files share one family name: satori falls
 * back across them glyph by glyph. `cyrillic-ext` carries the Tajik letters
 * (U+0493 U+04E3 U+049B U+04EF U+04B3 U+04B7). Arabic uses IBM Plex Sans Arabic because satori's
 * parser cannot read the GSUB lookups of the Noto Sans/Kufi/Naskh families
 * ("lookupType: 5 - substFormat: 3 is not yet supported") when shaping Arabic.
 * Files are traced into the standalone build by `outputFileTracingIncludes`
 * in next.config.ts.
 */

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

const FAMILY = "Noto";

const LATIN_CYRILLIC = ["latin", "latin-ext", "cyrillic", "cyrillic-ext"];

const fontFile = (pkg: string, name: string) =>
  path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", name);

async function load(file: string, weight: 400 | 700): Promise<OgFont> {
  const buffer = await readFile(file);
  const data = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  return { name: FAMILY, data, weight, style: "normal" };
}

const WEIGHTS = [400, 700] as const;

// Arabic cards use ONE family (IBM Plex Sans Arabic, with its own Latin for the
// brand name): once a Noto Sans file is in the list, satori also parses its
// GSUB tables while shaping Arabic text and fails on them (see above).
const ARABIC_SUBSETS = ["arabic", "latin", "latin-ext"];

export async function loadOgFonts(locale: string): Promise<OgFont[]> {
  const isArabic = locale === "ar";
  const pkg = isArabic ? "ibm-plex-sans-arabic" : "noto-sans";
  const subsets = isArabic ? ARABIC_SUBSETS : LATIN_CYRILLIC;
  return Promise.all(
    WEIGHTS.flatMap((weight) =>
      subsets.map((subset) =>
        load(fontFile(pkg, `${pkg}-${subset}-${weight}-normal.woff`), weight),
      ),
    ),
  );
}

export const OG_FONT_FAMILY = FAMILY;
