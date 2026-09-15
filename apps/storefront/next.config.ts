import type { NextConfig } from "next";
import { validateStorefrontConfiguration } from "./lib/config/server.ts";

validateStorefrontConfiguration();

const nextConfig: NextConfig = {};

export default nextConfig;
