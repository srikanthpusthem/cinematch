// Lifecycle persistence against real Postgres (npm run test:db). Uses its own
// tmdb_id range and cleans up only that range.
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../db/database-url";
import * as schema from "../db/schema";
import {
  SCENARIOS,
  day,
  observationsFor,
} from "./__fixtures__/lifecycle-scenarios";
import { applyObservations } from "./lifecycle-service";
import { createLifecycleStore } from "./lifecycle-store";

const root = path.resolve(__dirname, "../..");
const BASE = 9_200_000;

let sql: postgres.Sql;
let connected = false;
let store: ReturnType<typeof createLifecycleStore>;

async function cleanup() {
  await sql`delete from titles where tmdb_id >= ${BASE}`;
  await sql`delete from genres where id >= ${BASE}`;
}

async function insertTitle(
  n: number,
  title: string,
  releaseDate: string | null,
) {
  const [row] = await sql`
    insert into titles (kind, tmdb_id, title, release_date, tmdb_fetched_at)
    values ('movie', ${BASE + n}, ${title}, ${releaseDate}, now()) returning id`;
  return Number(row!.id);
}

async function pgError(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error as { code?: string; constraint_name?: string };
  }
  throw new Error("expected the statement to fail");
}

const recordOf = async (id: number) =>
  (await store.repository.load([id])).get(id)?.record;

beforeAll(async () => {
  sql = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 5,
    onnotice: () => {},
  });
  connected = true;
  await migrate(drizzle(sql), { migrationsFolder: path.join(root, "drizzle") });
  store = createLifecycleStore(drizzle(sql, { schema }));
});

beforeEach(cleanup);

afterAll(async () => {
  if (!connected) return;
  await cleanup();
  await sql.end();
});

describe("title_lifecycle constraints", () => {
  it("requires tombstone fields exactly when tombstoned", async () => {
    const id = await insertTitle(1, "Dune", "1984-12-14");
    const error = await pgError(
      () => sql`
        insert into title_lifecycle (title_id, status, first_seen_at, last_seen_at,
          last_observed_at, last_observation_run_id)
        values (${id}, 'tombstoned', now(), now(), now(), 'r')`,
    );
    expect(error).toMatchObject({
      code: "23514",
      constraint_name: "title_lifecycle_tombstone_consistent",
    });
  });

  it("forbids an active title that is marked missing", async () => {
    const id = await insertTitle(1, "Dune", "1984-12-14");
    const error = await pgError(
      () => sql`
        insert into title_lifecycle (title_id, status, first_seen_at, last_seen_at,
          last_observed_at, last_observation_run_id, missing_since, consecutive_missing)
        values (${id}, 'active', now(), now(), now(), 'r', now(), 1)`,
    );
    expect(error).toMatchObject({
      code: "23514",
      constraint_name: "title_lifecycle_active_not_missing",
    });
  });
});

describe("lifecycle repository (Postgres)", () => {
  it.each(SCENARIOS.map((s, i) => [s.name, s, i] as const))(
    "persists: %s",
    async (_name, scenario, i) => {
      const id = await insertTitle(
        i + 1,
        scenario.stored.title,
        scenario.stored.releaseYear
          ? `${scenario.stored.releaseYear}-06-01`
          : null,
      );
      const events: string[] = [];
      for (const o of observationsFor(scenario, id)) {
        const report = await applyObservations(store.repository, [o]);
        events.push(...Object.keys(report.byEvent));
      }
      expect(events).toEqual(scenario.events);
      expect(await recordOf(id)).toMatchObject({
        titleId: id,
        ...scenario.final,
      });
    },
  );

  it("restores with the same title id and keeps rows that reference it", async () => {
    const id = await insertTitle(1, "Dune", "1984-12-14");
    await sql`insert into genres (id, name) values (${BASE + 1}, 'Test Sci-Fi')`;
    await sql`insert into title_genres values (${id}, ${BASE + 1})`; // stand-in for feedback refs
    const restore = SCENARIOS.find((s) => s.name.startsWith("restore"))!;
    for (const o of observationsFor(restore, id))
      await applyObservations(store.repository, [o]);

    const [title] =
      await sql`select id from titles where tmdb_id = ${BASE + 1}`;
    expect(Number(title!.id)).toBe(id);
    const refs = await sql`select 1 from title_genres where title_id = ${id}`;
    expect(refs).toHaveLength(1);
    expect(await recordOf(id)).toMatchObject({
      status: "active",
      restoreCount: 1,
      restoredAt: day(30),
    });
  });

  it("leaves rows untouched on outages and on a replayed run", async () => {
    const id = await insertTitle(1, "Dune", "1984-12-14");
    const found = {
      titleId: id,
      runId: "run-0",
      at: day(0),
      result: "found" as const,
      identity: { title: "Dune", releaseYear: 1984 },
    };
    await applyObservations(store.repository, [found]);
    await applyObservations(store.repository, [
      { titleId: id, runId: "run-1", at: day(1), result: "missing" },
    ]);
    const rowBefore =
      await sql`select * from title_lifecycle where title_id = ${id}`;

    const outage = await applyObservations(store.repository, [
      { titleId: id, runId: "run-2", at: day(2), result: "error" },
    ]);
    const replay = await applyObservations(store.repository, [
      { titleId: id, runId: "run-1", at: day(1), result: "missing" },
    ]);
    expect(outage.unchangedOnError).toBe(1);
    expect(replay.byEvent).toEqual({ ignored_duplicate_run: 1 });
    expect(
      await sql`select * from title_lifecycle where title_id = ${id}`,
    ).toEqual(rowBefore);
  });

  it("summarizes status, tombstone reasons and retention without claiming purge eligibility", async (ctx) => {
    const [other] =
      await sql`select count(*)::int as n from titles where tmdb_id < ${BASE}`;
    if (other!.n > 0) ctx.skip(); // exact counts need a database with only test titles

    const ids = await Promise.all(
      [1, 2, 3, 4].map((n) => insertTitle(n, `T${n}`, "2000-01-01")),
    );
    const deleted = SCENARIOS.find((s) => s.name.startsWith("sustained"))!;
    for (const o of observationsFor(deleted, ids[0]!))
      await applyObservations(store.repository, [o]);
    await applyObservations(store.repository, [
      {
        titleId: ids[1]!,
        runId: "run-0",
        at: day(0),
        result: "found",
        identity: { title: "T2", releaseYear: 2000 },
      },
      { titleId: ids[2]!, runId: "run-0", at: day(0), result: "missing" },
    ]);
    await applyObservations(store.repository, [
      {
        titleId: ids[3]!,
        runId: "run-0",
        at: day(0),
        result: "found",
        identity: { title: "T4", releaseYear: 2000 },
      },
    ]);
    await applyObservations(store.repository, [
      {
        titleId: ids[3]!,
        runId: "run-5",
        at: day(5),
        result: "found",
        identity: { title: "Other", releaseYear: 2015 },
      },
    ]);

    expect(await store.summary(day(200))).toEqual({
      titles: 4,
      unobserved: 0,
      byStatus: { active: 1, unavailable: 1, tombstoned: 2 },
      tombstonedByReason: { source_deleted: 1, source_id_collision: 1 },
      retentionElapsed: 2, // tombstoned on days 8 and 5: both before the day-20 cutoff
      purgeEligible: null,
      purgeBlockedReason: "feedback_references_unknown",
    });
  });
});
