// US availability refresh CLI (issue #7). Usage:
//   npm run catalog:availability -- [--max-age-days 1] [--limit 50000] [--concurrency 8]
// Reads DATABASE_URL and TMDB_API_KEY from the environment or .env.local.
// Checks never-checked titles first, then the oldest; failed titles keep
// their previous availability and are retried first on the next run.
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  AvailabilityAbortedError,
  DEFAULT_AVAILABILITY_OPTIONS,
  createAvailabilityStore,
  refreshAvailability,
  type AvailabilityReport,
} from "../src/catalog/availability";
import { resolveDatabaseUrl } from "../src/db/database-url";
import * as schema from "../src/db/schema";
import { createTmdbClient } from "../src/tmdb/client";
import { intFlag, tmdbApiKey } from "./cli-env";

function printSummary(r: AvailabilityReport) {
  const a = r.availability;
  console.log(
    `\nStatus: ${r.status}${r.abortReason ? ` (${r.abortReason})` : ""}`,
  );
  console.log(
    `Checked ${r.saved}/${r.due} due: ${r.withUsOffers} with US offers, ` +
      `${r.withoutUsOffers} without; not found ${r.notFound}; failed ${JSON.stringify(r.failed)}`,
  );
  console.log(
    `Availability: ${a.checked}/${a.titles} titles checked, ${a.neverChecked} never, ` +
      `${a.stale} stale; ${a.withOffers} with offers, ${a.offers} offers, ` +
      `${a.providers} providers; fetched ${a.oldestFetchedAt?.toISOString() ?? "-"} .. ` +
      `${a.newestFetchedAt?.toISOString() ?? "-"}`,
  );
  console.log(`\nJSON report:\n${JSON.stringify(r, null, 2)}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "max-age-days": { type: "string" },
      limit: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  const d = DEFAULT_AVAILABILITY_OPTIONS;
  const options = {
    ...d,
    maxAgeDays: intFlag(values["max-age-days"], d.maxAgeDays, "max-age-days"),
    limit: intFlag(values.limit, d.limit, "limit"),
    concurrency: Math.max(
      1,
      intFlag(values.concurrency, d.concurrency, "concurrency"),
    ),
    log: (message: string) =>
      console.log(`${new Date().toISOString()} ${message}`),
  };

  const sql = postgres(resolveDatabaseUrl(), {
    max: options.concurrency + 1,
    onnotice: () => {},
  });
  try {
    const store = createAvailabilityStore(drizzle(sql, { schema }));
    const source = createTmdbClient({ apiKey: tmdbApiKey() });
    printSummary(await refreshAvailability(source, store, options));
  } catch (error) {
    if (error instanceof AvailabilityAbortedError) {
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
