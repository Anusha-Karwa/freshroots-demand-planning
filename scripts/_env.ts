// Load .env for CLI scripts (Next.js loads it on its own).
try {
  process.loadEnvFile(".env");
} catch {
  // no .env — every integration falls back to mock mode
}
