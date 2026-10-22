import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local, keyless dev database) ships WASM + data files; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
