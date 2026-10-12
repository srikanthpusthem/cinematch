// Shared helpers for catalog CLIs: credentials from the environment or
// .env.local (never echoed), and integer flag parsing.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { ENV_FILE } from "../src/db/database-url";

export function tmdbApiKey(): string {
  const fromEnv = process.env.TMDB_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(process.cwd(), ENV_FILE);
  const fromFile = existsSync(file)
    ? parseEnv(readFileSync(file, "utf8")).TMDB_API_KEY?.trim()
    : undefined;
  if (!fromFile) {
    throw new Error(
      `TMDB_API_KEY is not set in the environment or ${ENV_FILE}`,
    );
  }
  return fromFile;
}

export function intFlag(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return n;
}
