// Read-only catalog audit CLI (issue #14). Usage:
//   npm run catalog:audit -- [--sample 10] [--stale-hours 48] [--json]
// Reads DATABASE_URL from the environment or .env.local. Never writes: the
// audit runs in a READ ONLY transaction. Exits 1 when error findings exist.
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { formatAuditSummary, runCatalogAudit } from "../src/catalog/audit";
import { resolveDatabaseUrl } from "../src/db/database-url";
import * as schema from "../src/db/schema";

function positiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--${name} must be a positive integer`);
  return n;
}

async function main() {
  const { values } = parseArgs({
    options: {
      sample: { type: "string" },
      "stale-hours": { type: "string" },
      json: { type: "boolean" },
    },
  });
  const sql = postgres(resolveDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    const report = await runCatalogAudit(drizzle(sql, { schema }), {
      asOf: new Date(),
      sampleSize: positiveInt(values.sample, 10, "sample"),
      staleAfterHours: positiveInt(values["stale-hours"], 48, "stale-hours"),
    });
    console.log(
      values.json
        ? JSON.stringify(report, null, 2)
        : formatAuditSummary(report),
    );
    if (!report.healthy) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
