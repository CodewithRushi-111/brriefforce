// Test setup: make ANTHROPIC_API_KEY available to the opt-in live tests by
// reading .env.local, WITHOUT ever logging the value. Unit/mocked tests do not
// use it (they mock the SDK), so this is a no-op for them.
import { readFileSync } from "node:fs";

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const match = env.match(/^\s*ANTHROPIC_API_KEY=(.+)\s*$/m);
    if (match) {
      const value = match[1].trim();
      if (value && !value.includes("REPLACE_WITH")) {
        process.env.ANTHROPIC_API_KEY = value;
      }
    }
  } catch {
    // No .env.local — live tests will be skipped.
  }
}
