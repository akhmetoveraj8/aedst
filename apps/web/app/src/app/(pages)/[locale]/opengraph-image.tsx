import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { siteConfig } from "@/app/config/seo";
import { requireLocale } from "@/shared/i18n/require-locale";

export const alt = siteConfig.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });

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
        background: siteConfig.themeColor.light,
        color: "#171717",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700 }}>{t("appName")}</div>
      <div style={{ fontSize: 32, color: "#525252" }}>
        {t("appDescription")}
      </div>
    </div>,
    { ...size },
  );
}
