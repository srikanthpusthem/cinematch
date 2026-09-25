import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./database-url";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cinematch-db-url-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("resolveDatabaseUrl", () => {
  it("throws when .env.local is missing and DATABASE_URL is unset", () => {
    const cwd = makeTempDir();
    expect(() => resolveDatabaseUrl({ cwd, env: {} })).toThrow(/DATABASE_URL/);
  });

  it("throws when .env.local exists but DATABASE_URL is missing", () => {
    const cwd = makeTempDir();
    writeFileSync(path.join(cwd, ".env.local"), "TMDB_API_KEY=test\n");
    expect(() => resolveDatabaseUrl({ cwd, env: {} })).toThrow(/DATABASE_URL/);
  });

  it("reads DATABASE_URL from .env.local", () => {
    const cwd = makeTempDir();
    writeFileSync(
      path.join(cwd, ".env.local"),
      "DATABASE_URL=postgres://from-file\n",
    );
    expect(resolveDatabaseUrl({ cwd, env: {} })).toBe("postgres://from-file");
  });

  it("prefers non-empty DATABASE_URL from environment over .env.local", () => {
    const cwd = makeTempDir();
    writeFileSync(
      path.join(cwd, ".env.local"),
      "DATABASE_URL=postgres://from-file\n",
    );
    expect(
      resolveDatabaseUrl({
        cwd,
        env: {
          DATABASE_URL: "postgres://from-env",
        },
      }),
    ).toBe("postgres://from-env");
  });
});
