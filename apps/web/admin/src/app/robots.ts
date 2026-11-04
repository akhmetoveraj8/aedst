import type { MetadataRoute } from "next";

/** The admin panel is private: no crawler may index or follow anything. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
