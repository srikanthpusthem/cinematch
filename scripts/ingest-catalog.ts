// Catalog backfill CLI (issue #6). Usage:
//   npm run catalog:ingest -- [--movies 20000] [--series 5000] [--max-age-days 7]
//     [--concurrency 8] [--from-year 1950] [--to-year <this year>]
// Reads DATABASE_URL and TMDB_API_KEY from the environment or .env.local.
// Safe to re-run: titles fetched within --max-age-days are skipped.
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  DEFAULT_INGEST_OPTIONS,
  IngestAbortedError,
  ingestCatalog,
  type IngestReport,
} from "../src/catalog/ingest";
import { createCatalogStore } from "../src/catalog/store";
import { resolveDatabaseUrl } from "../src/db/database-url";
import * as schema from "../src/db/schema";
import { createTmdbClient } from "../src/tmdb/client";
import { intFlag, tmdbApiKey } from "./cli-env";

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
    movies: intFlag(values.movies, d.movies, "movies"),
    series: intFlag(values.series, d.series, "series"),
    maxAgeDays: intFlag(values["max-age-days"], d.maxAgeDays, "max-age-days"),
    concurrency: Math.max(
      1,
      intFlag(values.concurrency, d.concurrency, "concurrency"),
    ),
    fromYear: intFlag(values["from-year"], d.fromYear, "from-year"),
    toYear: intFlag(values["to-year"], d.toYear, "to-year"),
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
