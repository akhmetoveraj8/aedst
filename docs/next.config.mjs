import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["fumadocs-ui", "lucide-react", "@xyflow/react"],
  },
  // The per-module API pages moved from /api/<module> to /modules/<module>/api (2026-11-21).
  async redirects() {
    // No entry for "search": /api/search is this site's own search route and always shadowed that page.
    const modules = ["admin", "appattest", "capabilities", "integrity", "media", "notifications", "tasks"];
    return modules.map((m) => ({ source: `/api/${m}`, destination: `/modules/${m}/api`, permanent: true }));
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default withMDX(config);
