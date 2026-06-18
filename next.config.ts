import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Tesla requires the partner public key at this exact path. Serve it
        // from a route handler so it can read an env var or a local PEM file.
        source: "/.well-known/appspecific/com.tesla.3p.public-key.pem",
        destination: "/api/tesla/public-key",
      },
    ];
  },
};

export default nextConfig;
