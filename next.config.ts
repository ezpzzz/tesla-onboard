import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright serves the local app on 127.0.0.1. Next 16 blocks cross-origin
  // development chunks unless the test host is explicitly trusted.
  allowedDevOrigins: ["127.0.0.1"],
  // Retired single-tenant public variables must never be inlined into client
  // chunks through the untouched legacy config/content modules. Runtime tenant
  // settings now come from workspace_branding.features.onlyevs.
  env: {
    NEXT_PUBLIC_COMPANY_NAME: "",
    NEXT_PUBLIC_TAGLINE: "",
    NEXT_PUBLIC_HOST_NAME: "",
    NEXT_PUBLIC_HOST_PHONE: "",
    NEXT_PUBLIC_SUPPORT_EMAIL: "",
    NEXT_PUBLIC_ROADSIDE_PHONE: "",
  },
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
