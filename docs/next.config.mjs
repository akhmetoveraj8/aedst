import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["fumadocs-ui", "lucide-react", "@xyflow/react"],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default withMDX(config);
