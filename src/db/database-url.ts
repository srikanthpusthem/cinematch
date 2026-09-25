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

  const contents = readFileSync(envFile, "utf8");
  if (hasTruncatingHash(contents)) {
    throw new Error(
      `DATABASE_URL in ${ENV_FILE} contains an unquoted "#", which starts a ` +
        'comment and truncates the value. Wrap the value in quotes ("...") ' +
        "or percent-encode it as %23.",
    );
  }

  const fromFile = parseEnv(contents).DATABASE_URL?.trim();
  if (!fromFile) {
    throw new Error(
      `DATABASE_URL is empty in ${ENV_FILE}. ` +
        "Set it (see the docker-compose default in .env.example).",
    );
  }
  return fromFile;
}

/**
 * parseEnv treats any unquoted "#" as a comment start, so a password like
 * `p#ss` would be silently truncated to a still non-empty value. Flag a "#"
 * glued to the value; `URL # comment` (whitespace before "#") is fine.
 * Uses the last DATABASE_URL line, matching parseEnv's last-wins behavior.
 */
function hasTruncatingHash(contents: string): boolean {
  const lines = contents.match(/^\s*(?:export\s+)?DATABASE_URL\s*=.*$/gm);
  const raw = lines?.at(-1)?.split("=").slice(1).join("=").trim();
  if (!raw || /^["'`]/.test(raw)) return false;
  return /[^\s#]#/.test(raw);
}
