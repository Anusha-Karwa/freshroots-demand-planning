import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (the keyless local database) ships WASM files; keep it and pg out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // SAP CSV uploads go through a server action (Vercel still caps request bodies at 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  // Migrations and the seed CSVs must be inside the serverless bundle on Vercel.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
    "/data": ["./data/seed/*.csv", "./data/placeholder_prices.csv"],
  },
};

export default nextConfig;
