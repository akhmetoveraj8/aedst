import type { NextConfig } from "next";
import nextra from "nextra";

const withNextra = nextra({
  defaultShowCopyCode: true,
  readingTime: true,
  search: true,
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextra(nextConfig);
