import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@cloudfarm/bot-avatar"],
  // Keep the dev overlay off the sidebar's user footer.
  devIndicators: { position: "bottom-right" },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  // Both are off because Cache Components hangs on Workers: the runtime's
  // setTimeout makes Next warn "cannot guarantee that Cache Components will
  // run as expected", then every request is cancelled for never responding.
  // partialPrefetching requires cacheComponents, so it goes with it.
  cacheComponents: false,
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
