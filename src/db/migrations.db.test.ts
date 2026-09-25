// Integration check against a real pgvector Postgres. Run with `npm run test:db`
// (not part of `npm run test`). Uses the same DATABASE_URL resolution as
// drizzle.config.ts, so it exercises the documented .env.local workflow.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./database-url";

const root = path.resolve(__dirname, "../..");
const migrationsDir = path.join(root, "drizzle");
const url = resolveDatabaseUrl({ cwd: root });
const sql = postgres(url, { max: 1, onnotice: () => {} });

interface JournalEntry {
  tag: string;
  when: number;
}

const journal: JournalEntry[] = JSON.parse(
  readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
).entries;

const expected = journal.map((entry) => ({
  hash: createHash("sha256")
    .update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8"))
    .digest("hex"),
  createdAt: String(entry.when),
}));

/** Removes the connection string (and its password) from CLI output. */
function redact(output: string): string {
  const { password } = new URL(url);
  let safe = output.split(url).join("<DATABASE_URL>");
  if (password) safe = safe.split(decodeURIComponent(password)).join("***");
  return safe;
}

function migrate() {
  const result = spawnSync("npx", ["drizzle-kit", "migrate"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: redact(`${result.stdout}\n${result.stderr}`),
  };
}

async function appliedMigrations() {
  const rows = await sql<{ hash: string; created_at: string }[]>`
    select hash, created_at::text from drizzle.__drizzle_migrations order by id`;
  return rows.map((row) => ({ hash: row.hash, createdAt: row.created_at }));
}

afterAll(async () => {
  await sql.end();
});

describe("database migrations", () => {
  it("apply cleanly twice and record each journal entry once", async () => {
    const first = migrate();
    expect(first.status, first.output).toBe(0);
    expect(await appliedMigrations()).toEqual(expected);

    const second = migrate();
    expect(second.status, second.output).toBe(0);
    expect(await appliedMigrations()).toEqual(expected);
  });

  // Runs after the migration test above (tests in a file run in order).
  it("enable the pgvector extension", async () => {
    const [extension] = await sql<{ extversion: string }[]>`
      select extversion from pg_extension where extname = 'vector'`;
    expect(extension?.extversion).toMatch(/^\d+\.\d+/);

    const [row] = await sql<{ distance: number }[]>`
      select '[1,2,3]'::vector <-> '[1,2,4]'::vector as distance`;
    expect(row?.distance).toBe(1);
  });
});
