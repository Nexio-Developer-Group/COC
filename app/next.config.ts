import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["undici", "pdf-parse", "exceljs", "jszip"],
  /* config options here */
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
