import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Hide the on-screen Next.js development indicator (dev only; error overlays still appear).
  devIndicators: false,
  // Don't send the "X-Powered-By: Next.js" response header.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
