import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./database-url";

const FILE_URL = "postgresql://file:secret@localhost:5432/cinematch";
const ENV_URL = "postgresql://env:secret@db.example:5432/cinematch";

describe("resolveDatabaseUrl", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "cinematch-env-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeEnvFile = (contents: string) =>
    writeFileSync(path.join(cwd, ".env.local"), contents);

  it("reads DATABASE_URL from .env.local", () => {
    writeEnvFile(`# comment\nDATABASE_URL=${FILE_URL}\nTMDB_API_KEY=\n`);
    expect(resolveDatabaseUrl({ cwd, env: {} })).toBe(FILE_URL);
  });

  it("accepts quoted values", () => {
    writeEnvFile(`DATABASE_URL="${FILE_URL}"\n`);
    expect(resolveDatabaseUrl({ cwd, env: {} })).toBe(FILE_URL);
  });

  it("prefers an explicit environment value over .env.local", () => {
    writeEnvFile(`DATABASE_URL=${FILE_URL}\n`);
    expect(resolveDatabaseUrl({ cwd, env: { DATABASE_URL: ENV_URL } })).toBe(
      ENV_URL,
    );
  });

  it("uses the environment value when .env.local is missing", () => {
    expect(resolveDatabaseUrl({ cwd, env: { DATABASE_URL: ENV_URL } })).toBe(
      ENV_URL,
    );
  });

  it("falls back to .env.local when the environment value is empty", () => {
    writeEnvFile(`DATABASE_URL=${FILE_URL}\n`);
    expect(resolveDatabaseUrl({ cwd, env: { DATABASE_URL: "  " } })).toBe(
      FILE_URL,
    );
  });

  it("throws when .env.local is missing and the environment has no value", () => {
    expect(() => resolveDatabaseUrl({ cwd, env: {} })).toThrow(
      /\.env\.local was not found/,
    );
  });

  it("throws when DATABASE_URL is empty in .env.local", () => {
    writeEnvFile("DATABASE_URL=\nTMDB_API_KEY=\n");
    expect(() => resolveDatabaseUrl({ cwd, env: {} })).toThrow(
      /DATABASE_URL is empty in \.env\.local/,
    );
  });

  it("throws when DATABASE_URL is absent from .env.local", () => {
    writeEnvFile("TMDB_API_KEY=abc\n");
    expect(() => resolveDatabaseUrl({ cwd, env: {} })).toThrow(
      /DATABASE_URL is empty/,
    );
  });

  it("rejects an unquoted # that would truncate the value", () => {
    writeEnvFile("DATABASE_URL=postgresql://u:p#ss@localhost:5432/db\n");
    expect(() => resolveDatabaseUrl({ cwd, env: {} })).toThrow(/unquoted "#"/);
  });

  it("accepts a # inside a quoted value", () => {
    const url = "postgresql://u:p#ss@localhost:5432/db";
    writeEnvFile(`DATABASE_URL="${url}"\n`);
    expect(resolveDatabaseUrl({ cwd, env: {} })).toBe(url);
  });

  it("allows a trailing comment after whitespace", () => {
    writeEnvFile(`DATABASE_URL=${FILE_URL} # local docker\n`);
    expect(resolveDatabaseUrl({ cwd, env: {} })).toBe(FILE_URL);
  });

  it("ignores # in comments and other variables", () => {
    writeEnvFile(
      `# DATABASE_URL=a#b\nTMDB_API_KEY=x#y\nDATABASE_URL=${FILE_URL}\n`,
    );
    expect(resolveDatabaseUrl({ cwd, env: {} })).toBe(FILE_URL);
  });
});
