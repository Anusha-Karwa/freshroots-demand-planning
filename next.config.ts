import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local, keyless dev database) ships WASM + data files; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // SAP CSV uploads go through a server action. (Vercel caps request bodies at 4.5 MB regardless.)
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  // Ship the seed CSVs with the Data page so "Load the seed data" works on Vercel.
  outputFileTracingIncludes: { "/data": ["./data/seed/*.csv", "./data/placeholder_prices.csv"] },
};

export default nextConfig;
