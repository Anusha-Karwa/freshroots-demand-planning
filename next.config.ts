import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local, keyless dev database) ships WASM + data files; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // SAP CSV uploads go through a server action. (Vercel caps request bodies at 4.5 MB regardless.)
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
