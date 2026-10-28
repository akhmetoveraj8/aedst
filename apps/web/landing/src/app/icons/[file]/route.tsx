import { ImageResponse } from "next/og";

import { siteConfig } from "@/app/config/seo";

/**
 * Site icons rendered once at build time (static route) from the brand
 * constants, so there is no binary to keep in sync with `siteConfig`. Replace
 * with designed artwork by dropping PNGs into `public/icons/` and pointing
 * `manifest.ts` and `config/icons.ts` there.
 */

type Asset = {
  size: number;
  /** Maskable icons keep the mark inside the 80% safe zone. */
  variant: "icon" | "maskable";
};

const ASSETS: Record<string, Asset> = {
  "icon-192.png": { size: 192, variant: "icon" },
  "icon-512.png": { size: 512, variant: "icon" },
  "icon-maskable-512.png": { size: 512, variant: "maskable" },
  "apple-touch-icon.png": { size: 180, variant: "maskable" },
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ASSETS).map((file) => ({ file }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/icons/[file]">,
) {
  const { file } = await params;
  const asset = ASSETS[file];
  if (!asset) {
    return new Response("Not found", { status: 404 });
  }
  const markSize = asset.size * (asset.variant === "maskable" ? 0.5 : 0.62);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: siteConfig.themeColor.dark,
        borderRadius: asset.variant === "icon" ? asset.size * 0.22 : 0,
        color: siteConfig.themeColor.light,
        fontFamily: "sans-serif",
        fontSize: markSize,
        fontWeight: 800,
      }}
    >
      A
    </div>,
    {
      width: asset.size,
      height: asset.size,
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    },
  );
}
