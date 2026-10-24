// Scripts run outside Next.js, so load .env ourselves (Node 22 built-in). Import this first.
import fs from "node:fs";

for (const file of [".env.local", ".env"]) if (fs.existsSync(file)) process.loadEnvFile(file);
