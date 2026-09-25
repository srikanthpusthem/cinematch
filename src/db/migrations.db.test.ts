import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import journal from "../../drizzle/meta/_journal.json";
import { resolveDatabaseUrl } from "./database-url";

const repoRoot = path.resolve(__dirname, "../..");
const databaseUrl = resolveDatabaseUrl({ cwd: repoRoot });
const sql = postgres(databaseUrl, { max: 1 });

const runMigration = () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DATABASE_URL;
  const result = spawnSync("npm", ["run", "db:migrate"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.status, output).toBe(0);
  expect(output).not.toContain(databaseUrl);
};

const expectedMigrationHashes = journal.entries.map((entry) => {
  const migrationPath = path.join(repoRoot, "drizzle", `${entry.tag}.sql`);
  const content = readFileSync(migrationPath, "utf8");
  return createHash("sha256").update(content).digest("hex");
});

beforeEach(async () => {
  await sql`drop table if exists "__drizzle_migrations"`;
  await sql`drop extension if exists vector`;
});

afterAll(async () => {
  await sql.end({ timeout: 1 });
});

describe("drizzle migrations", () => {
  it("apply cleanly twice and record each journal entry once", async () => {
    runMigration();
    runMigration();

    const rows = await sql<{ hash: string }[]>`
      select hash from "__drizzle_migrations" order by id
    `;

    expect(rows).toHaveLength(expectedMigrationHashes.length);
    expect(rows.map((row) => row.hash)).toEqual(expectedMigrationHashes);
  });

  it("enable the pgvector extension", async () => {
    runMigration();

    const rows = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname = 'vector'
    `;

    expect(rows).toEqual([{ extname: "vector" }]);
  });
});
