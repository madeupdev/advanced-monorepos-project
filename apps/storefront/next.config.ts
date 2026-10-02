import type { NextConfig } from "next";
import { validateStorefrontConfiguration } from "./lib/config/server.ts";

validateStorefrontConfiguration();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd() + "/../..",
};

export default nextConfig;
