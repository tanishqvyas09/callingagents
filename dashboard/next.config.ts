import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the app to be embedded in iframes from any origin.
  // Remove or tighten `frame-ancestors` in production if you want to restrict
  // to specific domains only (e.g. `frame-ancestors https://yourdomain.com`).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Allow iframe embedding — remove X-Frame-Options entirely and use
          // CSP frame-ancestors instead (more flexible).
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
          // Needed for LiveKit WebRTC features inside an iframe
          {
            key: "Permissions-Policy",
            value: "microphone=*, camera=*, display-capture=*",
          },
          // Allow cross-origin isolation for SharedArrayBuffer (LiveKit needs this)
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
        ],
      },
    ];
  },

  // Standalone output — smallest possible Docker image, no node_modules needed at runtime
  output: "standalone",
};

export default nextConfig;
