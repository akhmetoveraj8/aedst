import { ImageResponse } from "next/og";

import { siteConfig } from "@/app/config/seo";

/**
 * PWA icons, notification badge and install-dialog screenshots, rendered
 * once at build time (static route) from the brand constants — no binary
 * assets to keep in sync with `siteConfig`. File names end in `.png`, so
 * `proxy.ts` never locale-redirects them. Replace with designed artwork by
 * dropping real PNGs into `public/icons/` and pointing `manifest.ts` there.
 */

type Asset = {
  width: number;
  height: number;
  /** Maskable icons keep the mark inside the 80% safe zone. */
  variant: "icon" | "maskable" | "badge" | "screenshot";
};

const ASSETS: Record<string, Asset> = {
  "icon-192.png": { width: 192, height: 192, variant: "icon" },
  "icon-512.png": { width: 512, height: 512, variant: "icon" },
  "icon-maskable-512.png": { width: 512, height: 512, variant: "maskable" },
  "apple-touch-icon.png": { width: 180, height: 180, variant: "maskable" },
  "badge-96.png": { width: 96, height: 96, variant: "badge" },
  "screenshot-wide.png": { width: 1280, height: 720, variant: "screenshot" },
  "screenshot-narrow.png": { width: 720, height: 1280, variant: "screenshot" },
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ASSETS).map((file) => ({ file }));
}

const DARK = siteConfig.themeColor.dark;
const LIGHT = siteConfig.themeColor.light;

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        fontWeight: 800,
        letterSpacing: -size * 0.04,
        color,
        fontFamily: "sans-serif",
      }}
    >
      A
    </div>
  );
}

function render({ width, height, variant }: Asset) {
  const short = Math.min(width, height);
  if (variant === "screenshot") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: short * 0.08,
          gap: short * 0.04,
          background: LIGHT,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: short * 0.07,
            fontWeight: 700,
            color: DARK,
          }}
        >
          {siteConfig.name}
        </div>
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            style={{
              display: "flex",
              height: short * 0.1,
              borderRadius: short * 0.02,
              border: "2px solid #e5e5e5",
              background: row === 0 ? "#f5f5f5" : LIGHT,
            }}
          />
        ))}
      </div>
    );
  }
  const isBadge = variant === "badge";
  const scale = variant === "maskable" ? 0.5 : 0.62;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Badges are drawn by the OS as a monochrome alpha mask.
        background: isBadge ? "transparent" : DARK,
        borderRadius: variant === "icon" ? short * 0.22 : 0,
      }}
    >
      <Mark size={short * scale} color={isBadge ? "#000000" : LIGHT} />
    </div>
  );
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
  return new ImageResponse(render(asset), {
    width: asset.width,
    height: asset.height,
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
}
