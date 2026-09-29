// Catalog backfill CLI (issue #6). Usage:
//   npm run catalog:ingest -- [--movies 20000] [--series 5000] [--max-age-days 7]
//     [--concurrency 8] [--from-year 1950] [--to-year <this year>]
// Reads DATABASE_URL and TMDB_API_KEY from the environment or .env.local.
// Safe to re-run: titles fetched within --max-age-days are skipped.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  DEFAULT_INGEST_OPTIONS,
  IngestAbortedError,
  ingestCatalog,
  type IngestReport,
} from "../src/catalog/ingest";
import { createCatalogStore } from "../src/catalog/store";
import { ENV_FILE, resolveDatabaseUrl } from "../src/db/database-url";
import * as schema from "../src/db/schema";
import { createTmdbClient } from "../src/tmdb/client";

function tmdbApiKey(): string {
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

const int = (value: string | undefined, fallback: number, name: string) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${name} must be a non-negative integer`);
  return n;
};

function printSummary(report: IngestReport) {
  const line = (label: string, r: IngestReport["movies"]) =>
    `${label}: target ${r.target}, candidates ${r.candidates}, fresh ${r.skippedFresh}, ` +
    `inserted ${r.inserted}, updated ${r.updated}, not found ${r.notFound}, ` +
    `failed ${JSON.stringify(r.failed)}`;
  console.log(
    `\nStatus: ${report.status}${report.abortReason ? ` (${report.abortReason})` : ""}`,
  );
  console.log(line("Movies", report.movies));
  console.log(line("Series", report.series));
  const c = report.catalog;
  console.log(
    `Catalog: ${c.movies} movies, ${c.series} series, ${c.seasons} seasons, ` +
      `${c.genres} genres, ${c.keywords} keywords; fetched ` +
      `${c.oldestFetchedAt?.toISOString() ?? "-"} .. ${c.newestFetchedAt?.toISOString() ?? "-"}`,
  );
  console.log(`\nJSON report:\n${JSON.stringify(report, null, 2)}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      movies: { type: "string" },
      series: { type: "string" },
      "max-age-days": { type: "string" },
      concurrency: { type: "string" },
      "from-year": { type: "string" },
      "to-year": { type: "string" },
    },
  });
  const d = DEFAULT_INGEST_OPTIONS;
  const options = {
    ...d,
    movies: int(values.movies, d.movies, "movies"),
    series: int(values.series, d.series, "series"),
    maxAgeDays: int(values["max-age-days"], d.maxAgeDays, "max-age-days"),
    concurrency: Math.max(
      1,
      int(values.concurrency, d.concurrency, "concurrency"),
    ),
    fromYear: int(values["from-year"], d.fromYear, "from-year"),
    toYear: int(values["to-year"], d.toYear, "to-year"),
    log: (message: string) =>
      console.log(`${new Date().toISOString()} ${message}`),
  };

  const sql = postgres(resolveDatabaseUrl(), {
    max: options.concurrency + 1,
    onnotice: () => {},
  });
  try {
    const store = createCatalogStore(drizzle(sql, { schema }));
    const source = createTmdbClient({ apiKey: tmdbApiKey() });
    printSummary(await ingestCatalog(source, store, options));
  } catch (error) {
    if (error instanceof IngestAbortedError) {
      printSummary(error.report);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  // Errors from the TMDB client and env loaders never include secrets.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
