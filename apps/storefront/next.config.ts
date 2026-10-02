import path from "node:path";
import type { NextConfig } from "next";
import { validateStorefrontConfiguration } from "./lib/config/server.ts";

validateStorefrontConfiguration();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  turbopack: { root: path.resolve(process.cwd(), "../..") },
};

export default nextConfig;
