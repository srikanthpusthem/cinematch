import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const ENV_FILE = ".env.local";

export interface ResolveDatabaseUrlOptions {
  /** Directory containing `.env.local`. Defaults to the current directory. */
  cwd?: string;
  /** Environment to check first. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Resolves DATABASE_URL for CLI tools (drizzle-kit) that don't load
 * `.env.local` the way Next.js does. A non-empty DATABASE_URL in the
 * environment wins; otherwise it is read from `.env.local`.
 */
export function resolveDatabaseUrl({
  cwd = process.cwd(),
  env = process.env,
}: ResolveDatabaseUrlOptions = {}): string {
  const fromEnv = env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;

  const envFile = path.join(cwd, ENV_FILE);
  if (!existsSync(envFile)) {
    throw new Error(
      `DATABASE_URL is not set and ${ENV_FILE} was not found. ` +
        `Run \`cp .env.example ${ENV_FILE}\` and fill in DATABASE_URL.`,
    );
  }

  const fromFile = parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL?.trim();
  if (!fromFile) {
    throw new Error(
      `DATABASE_URL is empty in ${ENV_FILE}. ` +
        "Set it (see the docker-compose default in .env.example).",
    );
  }
  return fromFile;
}
