import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { loadOgFonts, OG_FONT_FAMILY } from "@/app/config/og-fonts";
import { siteConfig } from "@/app/config/seo";
import { requireLocale } from "@/shared/i18n/require-locale";

export const alt = siteConfig.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Rendered at build time per locale (generateStaticParams in the layout).
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });
  const fonts = await loadOgFonts(locale);
  const isRtl = locale === "ar";
  const direction = isRtl ? "rtl" : "ltr";
  const description = t("appDescription");

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 64,
        background: siteConfig.themeColor.light,
        color: siteConfig.themeColor.dark,
        direction,
        fontFamily: OG_FONT_FAMILY,
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700 }}>{t("appName")}</div>
      <div
        style={{
          display: "flex",
          flexDirection: isRtl ? "row-reverse" : "row",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: "0.3em",
          maxWidth: "100%",
          fontSize: 32,
          textAlign: "center",
          opacity: 0.7,
          lineHeight: 1.4,
        }}
      >
        {/* satori has no bidi reordering: one flex item per word in a
            `row-reverse` wrapping row places words right to left and wraps
            from the right (satori ignores `direction: rtl` for text order). */}
        {isRtl
          ? description.split(" ").map((word, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static words, order never changes
              <div key={index} style={{ display: "flex" }}>
                {word}
              </div>
            ))
          : description}
      </div>
    </div>,
    { ...size, fonts },
  );
}
