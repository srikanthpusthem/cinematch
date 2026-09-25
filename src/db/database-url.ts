import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

type Env = Record<string, string | undefined>;

interface ResolveDatabaseUrlOptions {
  env?: Env;
  cwd?: string;
}

const DATABASE_URL_ERROR =
  "DATABASE_URL is required (set it in environment or .env.local; see .env.example)";

const readDatabaseUrl = (env: Env): string | undefined => {
  const value = env.DATABASE_URL?.trim();
  return value ? value : undefined;
};

export function resolveDatabaseUrl({
  env = process.env,
  cwd = process.cwd(),
}: ResolveDatabaseUrlOptions = {}): string {
  const fromEnv = readDatabaseUrl(env);
  if (fromEnv) return fromEnv;

  const envPath = path.join(cwd, ".env.local");
  let parsedEnv: ReturnType<typeof parseEnv>;
  try {
    parsedEnv = parseEnv(readFileSync(envPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(DATABASE_URL_ERROR);
    }
    throw error;
  }

  const fromFile = readDatabaseUrl(parsedEnv);
  if (fromFile) return fromFile;

  throw new Error(DATABASE_URL_ERROR);
}
