import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dbConfig from "../../vitest.db.config";
import * as databaseSafety from "./test-database-safety";
import {
  assertLocalTestDatabaseUrl,
  resolveTestDatabaseUrl,
} from "./test-database-safety";

const LOCAL_URL = "postgresql://cinematch:cinematch@localhost:5432/cinematch";
const REMOTE_URL = "postgresql://user:private-password@db.example/catalog";

describe("assertLocalTestDatabaseUrl", () => {
  it.each([
    LOCAL_URL,
    "postgres://user:secret@localhost:5432/test",
    "postgresql://user:secret@127.0.0.1:5432/test",
    "postgresql://user:secret@[::1]:5432/test",
    "postgresql://localhost/test",
    "postgresql://127.0.0.1/test",
    "postgresql://[::1]/test",
    "postgresql://user:p%40ss%23word@localhost/test",
  ])("accepts an explicit canonical local URL: %s", (url) => {
    expect(() => assertLocalTestDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    REMOTE_URL,
    "postgresql://user:secret@ep-private.us-east-2.aws.neon.tech/catalog",
    "postgresql://user:secret@192.168.1.1/catalog",
    "postgresql://localhost.example/catalog",
    "postgresql://localhost./catalog",
    "postgresql://LOCALHOST/catalog",
    "postgresql://localhost@remote.example/catalog",
    "postgresql://remote.example@user@localhost/catalog",
    "postgresql://localhost,remote.example/catalog",
    "postgresql://localhost%2cremote.example/catalog",
    "postgresql://%6cocalhost/catalog",
    "postgresql://%31%32%37.0.0.1/catalog",
    "postgresql://127.1/catalog",
    "postgresql://127.0.1/catalog",
    "postgresql://127.0.0.2/catalog",
    "postgresql://0177.0.0.1/catalog",
    "postgresql://0x7f000001/catalog",
    "postgresql://2130706433/catalog",
    "postgresql://[0:0:0:0:0:0:0:1]/catalog",
    "postgresql://[::ffff:127.0.0.1]/catalog",
    "postgresql://localhost/catalog?host=remote.example",
    "postgresql://localhost/catalog?hostaddr=192.168.1.1",
    "postgresql://localhost/catalog?port=5432",
    "postgresql://localhost/catalog?%68ost=remote.example",
    "postgresql://localhost/catalog?sslmode=require",
    "postgresql://localhost/catalog?",
    "postgresql://localhost/catalog#fragment",
    "postgresql://localhost/catalog#",
    "http://localhost/catalog",
    "file://localhost/catalog",
    "postgresql:localhost/catalog",
    "postgresql:///catalog",
    "postgresql://localhost:0/catalog",
    "postgresql://localhost:65536/catalog",
    "postgresql://localhost:invalid/catalog",
    "postgresql://localhost:/catalog",
    "postgresql://user:bad%escape@localhost/catalog",
    "postgresql://user:secret@local\nhost/catalog",
    "postgresql://user:\u0000secret@localhost/catalog",
    "postgresql://user:secret@localhost\\remote.example/catalog",
    " postgresql://localhost/catalog",
    "postgresql://localhost/catalog ",
    "not a URL",
    "",
  ])("rejects unsafe or malformed URLs: %s", (url) => {
    expect(() => assertLocalTestDatabaseUrl(url)).toThrow(
      /disposable local Postgres database/,
    );
  });

  it("does not expose the rejected URL or parser error details", () => {
    for (const url of [
      REMOTE_URL,
      "postgresql://user:private-password@localhost:invalid/catalog",
    ]) {
      let error: Error | undefined;
      try {
        assertLocalTestDatabaseUrl(url);
      } catch (caught) {
        error = caught as Error;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).not.toContain(url);
      expect(error?.message).not.toContain("private-password");
      expect(error?.cause).toBeUndefined();
    }
  });
});

describe("resolveTestDatabaseUrl", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "cinematch-test-db-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeEnvFile(url: string) {
    writeFileSync(path.join(cwd, ".env.local"), `DATABASE_URL="${url}"\n`);
  }

  it("accepts the CI .env.local configuration without an environment URL", () => {
    writeEnvFile(LOCAL_URL);
    expect(resolveTestDatabaseUrl({ cwd, env: {} })).toBe(LOCAL_URL);
  });

  it("rejects a remote .env.local target", () => {
    writeEnvFile(REMOTE_URL);
    expect(() => resolveTestDatabaseUrl({ cwd, env: {} })).toThrow(
      /disposable local Postgres database/,
    );
  });

  it("rejects an unsafe environment override even with a safe .env.local", () => {
    writeEnvFile(LOCAL_URL);
    expect(() =>
      resolveTestDatabaseUrl({ cwd, env: { DATABASE_URL: REMOTE_URL } }),
    ).toThrow(/disposable local Postgres database/);
  });

  it("accepts a safe environment override even with a remote .env.local", () => {
    writeEnvFile(REMOTE_URL);
    expect(
      resolveTestDatabaseUrl({ cwd, env: { DATABASE_URL: LOCAL_URL } }),
    ).toBe(LOCAL_URL);
  });

  it("uses the environment URL without needing .env.local", () => {
    expect(
      resolveTestDatabaseUrl({ cwd, env: { DATABASE_URL: LOCAL_URL } }),
    ).toBe(LOCAL_URL);
  });

  it("falls back to .env.local for an empty environment URL", () => {
    writeEnvFile(LOCAL_URL);
    expect(resolveTestDatabaseUrl({ cwd, env: { DATABASE_URL: "  " } })).toBe(
      LOCAL_URL,
    );
  });

  it("preserves setup guidance when neither source has a URL", () => {
    expect(() => resolveTestDatabaseUrl({ cwd, env: {} })).toThrow(
      /cp \.env\.example \.env\.local/,
    );
  });

  it("preserves setup guidance when .env.local has an empty URL", () => {
    writeEnvFile("");
    expect(() => resolveTestDatabaseUrl({ cwd, env: {} })).toThrow(
      /DATABASE_URL is empty in \.env\.local.*\.env\.example/,
    );
  });

  it("preserves the loader's safe unquoted-hash validation", () => {
    writeFileSync(
      path.join(cwd, ".env.local"),
      "DATABASE_URL=postgresql://user:private#password@localhost/catalog\n",
    );
    expect(() => resolveTestDatabaseUrl({ cwd, env: {} })).toThrow(/unquoted/);
    expect(() => resolveTestDatabaseUrl({ cwd, env: {} })).not.toThrow(
      /private#password/,
    );
  });
});

describe("database test setup", () => {
  it("registers the guard for every DB suite and matches the app alias", () => {
    expect(dbConfig).toMatchObject({
      resolve: {
        alias: { "@": path.resolve(__dirname, "..") },
      },
      test: {
        setupFiles: ["./src/db/test-database-setup.ts"],
        include: ["src/**/*.db.test.ts"],
      },
    });
  });

  it("checks the repository root immediately and propagates a refusal", async () => {
    const guard = vi
      .spyOn(databaseSafety, "resolveTestDatabaseUrl")
      .mockImplementation(() => {
        throw new Error("Unsafe test database target");
      });

    try {
      await expect(import("./test-database-setup")).rejects.toThrow(
        "Unsafe test database target",
      );
      expect(guard).toHaveBeenCalledExactlyOnceWith({
        cwd: path.resolve(__dirname, "../.."),
      });
    } finally {
      guard.mockRestore();
    }
  });
});
