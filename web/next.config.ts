import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev binds 0.0.0.0; Preview opens 127.0.0.1 and Next treats that as cross-origin without this.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  agentRules: false,
  experimental: {
    proxyClientMaxBodySize: "16mb",
  },
};

export default nextConfig;
