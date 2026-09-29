// Integration checks for the M1 catalog schema (drizzle/0001_catalog_schema.sql)
// against a real pgvector Postgres. Run with `npm run test:db`. Each case runs
// in a transaction that is rolled back, so the database is left empty.
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./database-url";

const root = path.resolve(__dirname, "../..");
const migrationsFolder = path.join(root, "drizzle");

let sql: postgres.Sql;
type Tx = postgres.TransactionSql;

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back. */
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Asserts `run` fails with the SQLSTATE (and constraint, if given), then recovers. */
async function expectPgError(
  tx: Tx,
  code: string,
  constraint: string | null,
  run: (sp: Tx) => Promise<unknown>,
): Promise<void> {
  let caught: { code?: string; constraint_name?: string } | undefined;
  try {
    await tx.savepoint(run);
  } catch (error) {
    caught = error as typeof caught;
  }
  expect(caught, "expected the statement to fail").toBeDefined();
  expect(caught?.code).toBe(code);
  if (constraint) expect(caught?.constraint_name).toBe(constraint);
}

async function insertTitle(
  tx: Tx,
  kind: "movie" | "series",
  tmdbId: number,
): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    insert into titles (kind, tmdb_id, title, tmdb_fetched_at)
    values (${kind}, ${tmdbId}, ${`Title ${tmdbId}`}, now())
    returning id`;
  return Number(row!.id);
}

async function insertMovie(tx: Tx, tmdbId: number): Promise<number> {
  const id = await insertTitle(tx, "movie", tmdbId);
  await tx`insert into movies (title_id, runtime_minutes) values (${id}, 120)`;
  return id;
}

async function insertSeries(tx: Tx, tmdbId: number): Promise<number> {
  const id = await insertTitle(tx, "series", tmdbId);
  await tx`insert into series (title_id, season_count) values (${id}, 2)`;
  return id;
}

async function count(tx: Tx, table: string, titleId: number): Promise<number> {
  const column = table === "seasons" ? "series_id" : "title_id";
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from ${tx(table)} where ${tx(column)} = ${titleId}`;
  return row!.n;
}

beforeAll(async () => {
  sql = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 1,
    onnotice: () => {},
  });
  await migrate(drizzle(sql), { migrationsFolder });
});

afterAll(async () => {
  await sql?.end();
});

describe("catalog schema: structure", () => {
  const tables = [
    "genres",
    "keywords",
    "movies",
    "seasons",
    "series",
    "title_availability",
    "title_embeddings",
    "title_genres",
    "title_keywords",
    "title_offers",
    "titles",
    "watch_providers",
  ];

  it("creates every catalog table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ${sql(tables)}`;
    expect(rows.map((r) => r.table_name).sort()).toEqual(tables);
  });

  it("creates the query-driven secondary indexes", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and indexname like '%\\_idx'`;
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs["title_offers_provider_monetization_idx"]).toContain(
      "(provider_id, monetization, title_id)",
    );
    expect(defs["title_availability_fetched_at_idx"]).toContain("(fetched_at)");
    expect(defs["title_genres_genre_id_idx"]).toContain("(genre_id)");
    expect(defs["title_keywords_keyword_id_idx"]).toContain("(keyword_id)");
  });

  it("backs every foreign key with an index on its leading columns", async () => {
    const fks = await sql<{ name: string; tbl: string; cols: string[] }[]>`
      select c.conname as name, c.conrelid::regclass::text as tbl,
             array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n
                   order by k.i) as cols
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
    const indexes = await sql<{ tbl: string; cols: string[] }[]>`
      select i.indrelid::regclass::text as tbl,
             array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k(n, j)
                   join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n
                   order by k.j) as cols
      from pg_index i join pg_class t on t.oid = i.indrelid
      where t.relnamespace = 'public'::regnamespace`;

    expect(fks.length).toBe(12);
    const isPrefix = (a: string[], b: string[]) =>
      a.every((c, i) => b[i] === c);
    const unindexed = fks.filter(
      (fk) =>
        !indexes.some(
          (ix) =>
            ix.tbl === fk.tbl &&
            (isPrefix(ix.cols, fk.cols) || isPrefix(fk.cols, ix.cols)),
        ),
    );
    expect(unindexed.map((fk) => fk.name)).toEqual([]);
  });

  it("re-applying the migration SQL is a no-op", async () => {
    const migration = readFileSync(
      path.join(migrationsFolder, "0001_catalog_schema.sql"),
      "utf8",
    );
    const constraintCount = async () => {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from pg_constraint
        where connamespace = 'public'::regnamespace`;
      return row!.n;
    };
    const before = await constraintCount();
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    expect(await constraintCount()).toBe(before);
  });
});

describe("catalog schema: titles and subtypes", () => {
  it("keys titles by (kind, tmdb_id), since TMDB movie and TV ids overlap", async () => {
    await inRolledBackTx(async (tx) => {
      await insertTitle(tx, "movie", 1396);
      await insertTitle(tx, "series", 1396);
      await expectPgError(tx, "23505", "titles_kind_tmdb_id_key", (sp) =>
        insertTitle(sp, "movie", 1396),
      );
    });
  });

  it("rejects a subtype row whose title has the other kind", async () => {
    await inRolledBackTx(async (tx) => {
      const seriesTitle = await insertTitle(tx, "series", 1);
      const movieTitle = await insertTitle(tx, "movie", 2);
      await expectPgError(
        tx,
        "23503",
        "movies_title_fkey",
        (sp) => sp`insert into movies (title_id) values (${seriesTitle})`,
      );
      await expectPgError(
        tx,
        "23503",
        "series_title_fkey",
        (sp) => sp`insert into series (title_id) values (${movieTitle})`,
      );
      await expectPgError(
        tx,
        "23514",
        "movies_kind_is_movie",
        (sp) =>
          sp`insert into movies (title_id, kind) values (${seriesTitle}, 'series')`,
      );
    });
  });

  it("enforces value checks", async () => {
    await inRolledBackTx(async (tx) => {
      await expectPgError(
        tx,
        "23514",
        "titles_title_not_blank",
        (sp) =>
          sp`insert into titles (kind, tmdb_id, title, tmdb_fetched_at)
           values ('movie', 10, '  ', now())`,
      );
      await expectPgError(
        tx,
        "23514",
        "titles_vote_average_range",
        (sp) =>
          sp`insert into titles (kind, tmdb_id, title, vote_average, tmdb_fetched_at)
           values ('movie', 11, 'X', 10.5, now())`,
      );
      await expectPgError(
        tx,
        "23514",
        "titles_tmdb_id_positive",
        (sp) =>
          sp`insert into titles (kind, tmdb_id, title, tmdb_fetched_at)
           values ('movie', 0, 'X', now())`,
      );
      const id = await insertTitle(tx, "movie", 12);
      await expectPgError(
        tx,
        "23514",
        "movies_runtime_positive",
        (sp) =>
          sp`insert into movies (title_id, runtime_minutes) values (${id}, 0)`,
      );
      await expectPgError(
        tx,
        "23514",
        "movies_imdb_id_format",
        (sp) =>
          sp`insert into movies (title_id, imdb_id) values (${id}, 'abc')`,
      );
    });
  });
});

describe("catalog schema: seasons", () => {
  it("attaches seasons only to series, uniquely per number", async () => {
    await inRolledBackTx(async (tx) => {
      const show = await insertSeries(tx, 1396);
      const movie = await insertMovie(tx, 550);

      await tx`insert into seasons (series_id, season_number, episode_count)
               values (${show}, 0, 9), (${show}, 1, 7)`;
      await expectPgError(
        tx,
        "23505",
        "seasons_series_id_season_number_key",
        (sp) =>
          sp`insert into seasons (series_id, season_number) values (${show}, 1)`,
      );
      await expectPgError(
        tx,
        "23503",
        null,
        (sp) =>
          sp`insert into seasons (series_id, season_number) values (${movie}, 1)`,
      );
      await expectPgError(
        tx,
        "23514",
        "seasons_season_number_nonnegative",
        (sp) =>
          sp`insert into seasons (series_id, season_number) values (${show}, -1)`,
      );
    });
  });
});

describe("catalog schema: US availability", () => {
  it("records checked-with-no-offers separately from never-checked", async () => {
    await inRolledBackTx(async (tx) => {
      const checked = await insertMovie(tx, 1);
      await insertMovie(tx, 2);
      await tx`insert into title_availability (title_id, fetched_at) values (${checked}, now())`;

      const rows = await tx<
        { tmdb_id: number; checked: boolean; offers: number }[]
      >`
        select t.tmdb_id, a.title_id is not null as checked,
               (select count(*)::int from title_offers o where o.title_id = t.id) as offers
        from titles t left join title_availability a on a.title_id = t.id
        order by t.tmdb_id`;
      expect(rows).toEqual([
        { tmdb_id: 1, checked: true, offers: 0 },
        { tmdb_id: 2, checked: false, offers: 0 },
      ]);
    });
  });

  it("is US-only and requires a checked availability row for offers", async () => {
    await inRolledBackTx(async (tx) => {
      const id = await insertMovie(tx, 550);
      await tx`insert into watch_providers (id, name) values (8, 'Netflix')`;

      await expectPgError(
        tx,
        "23514",
        "title_availability_region_us",
        (sp) =>
          sp`insert into title_availability (title_id, region, fetched_at)
           values (${id}, 'CA', now())`,
      );
      await expectPgError(
        tx,
        "23503",
        "title_offers_availability_fkey",
        (sp) =>
          sp`insert into title_offers (title_id, provider_id, monetization)
           values (${id}, 8, 'flatrate')`,
      );

      await tx`insert into title_availability (title_id, fetched_at) values (${id}, now())`;
      await tx`insert into title_offers (title_id, provider_id, monetization)
               values (${id}, 8, 'flatrate'), (${id}, 8, 'rent')`;
      await expectPgError(
        tx,
        "23505",
        "title_offers_pkey",
        (sp) =>
          sp`insert into title_offers (title_id, provider_id, monetization)
           values (${id}, 8, 'flatrate')`,
      );
      await expectPgError(
        tx,
        "22P02",
        null,
        (sp) =>
          sp`insert into title_offers (title_id, provider_id, monetization)
           values (${id}, 8, 'subscription')`,
      );
      await expectPgError(
        tx,
        "23503",
        null,
        (sp) =>
          sp`insert into title_offers (title_id, provider_id, monetization)
           values (${id}, 999, 'free')`,
      );
    });
  });

  it("refreshing availability replaces its offers", async () => {
    await inRolledBackTx(async (tx) => {
      const id = await insertMovie(tx, 550);
      await tx`insert into watch_providers (id, name) values (8, 'Netflix')`;
      await tx`insert into title_availability (title_id, fetched_at) values (${id}, now())`;
      await tx`insert into title_offers (title_id, provider_id, monetization)
               values (${id}, 8, 'flatrate')`;

      await tx`delete from title_availability where title_id = ${id}`;
      expect(await count(tx, "title_offers", id)).toBe(0);
    });
  });
});

describe("catalog schema: delete behavior", () => {
  it("cascades a title delete to everything it owns", async () => {
    await inRolledBackTx(async (tx) => {
      const show = await insertSeries(tx, 1396);
      await tx`insert into genres (id, name) values (18, 'Drama')`;
      await tx`insert into keywords (id, name) values (1, 'chemistry')`;
      await tx`insert into watch_providers (id, name) values (8, 'Netflix')`;
      await tx`insert into seasons (series_id, season_number) values (${show}, 1)`;
      await tx`insert into title_genres values (${show}, 18)`;
      await tx`insert into title_keywords values (${show}, 1)`;
      await tx`insert into title_availability (title_id, fetched_at) values (${show}, now())`;
      await tx`insert into title_offers (title_id, provider_id, monetization) values (${show}, 8, 'flatrate')`;
      await tx`insert into title_embeddings (title_id, model, dimensions, embedding, content_hash)
               values (${show}, 'test/model@v1', 3, '[1,0,0]', 'h')`;

      await tx`delete from titles where id = ${show}`;

      for (const table of [
        "series",
        "seasons",
        "title_genres",
        "title_keywords",
        "title_availability",
        "title_offers",
        "title_embeddings",
      ]) {
        expect(await count(tx, table, show), table).toBe(0);
      }
      const [ref] = await tx<{ n: number }[]>`
        select (select count(*) from genres) + (select count(*) from keywords)
             + (select count(*) from watch_providers) as n`;
      expect(Number(ref!.n)).toBe(3);
    });
  });

  it("refuses to delete reference data that titles still use", async () => {
    await inRolledBackTx(async (tx) => {
      const id = await insertMovie(tx, 550);
      await tx`insert into genres (id, name) values (18, 'Drama')`;
      await tx`insert into keywords (id, name) values (1, 'twist')`;
      await tx`insert into watch_providers (id, name) values (8, 'Netflix')`;
      await tx`insert into title_genres values (${id}, 18)`;
      await tx`insert into title_keywords values (${id}, 1)`;
      await tx`insert into title_availability (title_id, fetched_at) values (${id}, now())`;
      await tx`insert into title_offers (title_id, provider_id, monetization) values (${id}, 8, 'ads')`;

      await expectPgError(
        tx,
        "23503",
        null,
        (sp) => sp`delete from genres where id = 18`,
      );
      await expectPgError(
        tx,
        "23503",
        null,
        (sp) => sp`delete from keywords where id = 1`,
      );
      await expectPgError(
        tx,
        "23503",
        null,
        (sp) => sp`delete from watch_providers where id = 8`,
      );
    });
  });
});

describe("catalog schema: embeddings", () => {
  it("stores versioned embeddings of any size with a matching dimension", async () => {
    await inRolledBackTx(async (tx) => {
      const id = await insertMovie(tx, 550);
      await tx`insert into title_embeddings (title_id, model, dimensions, embedding, content_hash)
               values (${id}, 'a/small@v1', 3, '[1,0,0]', 'h1'),
                      (${id}, 'b/large@v1', 4, '[0,1,0,0]', 'h1')`;

      await expectPgError(
        tx,
        "23514",
        "title_embeddings_dimensions_match",
        (sp) =>
          sp`insert into title_embeddings (title_id, model, dimensions, embedding, content_hash)
           values (${id}, 'c/bad@v1', 3, '[1,0]', 'h')`,
      );
      await expectPgError(
        tx,
        "23505",
        "title_embeddings_pkey",
        (sp) =>
          sp`insert into title_embeddings (title_id, model, dimensions, embedding, content_hash)
           values (${id}, 'a/small@v1', 3, '[0,1,0]', 'h2')`,
      );

      const [row] = await tx<{ distance: number }[]>`
        select embedding <=> '[1,0,0]'::vector as distance
        from title_embeddings where model = 'a/small@v1'`;
      expect(row?.distance).toBe(0);
    });
  });
});
