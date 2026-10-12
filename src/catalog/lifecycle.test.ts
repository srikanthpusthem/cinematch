import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  T0,
  day,
  observationsFor,
} from "./__fixtures__/lifecycle-scenarios";
import {
  applyObservation,
  isPresentable,
  isSourceIdCollision,
  presentableAvailability,
  purgeEligibility,
  type LifecycleRecord,
  type Observation,
} from "./lifecycle";
import {
  applyObservations,
  createMemoryLifecycleRepository,
} from "./lifecycle-service";

describe("lifecycle scenarios", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const { repo, records } = createMemoryLifecycleRepository(
        new Map([[1, scenario.stored]]),
      );
      const events: string[] = [];
      let actions = 0;
      // One run per step, as the refresh job would do.
      for (const o of observationsFor(scenario, 1)) {
        const report = await applyObservations(repo, [o]);
        events.push(...Object.keys(report.byEvent));
        actions += report.actions.length;
      }
      expect(events).toEqual(scenario.events);
      expect(records.get(1)).toMatchObject({ titleId: 1, ...scenario.final });
      expect(actions > 0).toBe(!!scenario.collision);
      // The first sighting is never rewritten.
      expect(records.get(1)?.firstSeenAt).toEqual(day(scenario.steps[0]!.day));
    },
  );
});

describe("applyObservation", () => {
  const found = (d: number, runId = `run-${d}`): Observation => ({
    titleId: 1,
    runId,
    at: day(d),
    result: "found",
    identity: { title: "Dune", releaseYear: 1984 },
  });
  const missing = (d: number, runId = `run-${d}`): Observation => ({
    titleId: 1,
    runId,
    at: day(d),
    result: "missing",
  });

  it("ignores a replayed run id (idempotent)", () => {
    const first = applyObservation(undefined, undefined, found(0)).record!;
    const unavailable = applyObservation(first, undefined, missing(1)).record!;
    const replay = applyObservation(unavailable, undefined, missing(1));
    expect(replay).toEqual({
      record: unavailable,
      changed: false,
      event: "ignored_duplicate_run",
    });
    expect(replay.record?.consecutiveMissing).toBe(1);
  });

  it("ignores observations older than the last one", () => {
    const r = applyObservation(undefined, undefined, found(5)).record!;
    expect(applyObservation(r, undefined, missing(2, "late-run")).event).toBe(
      "ignored_out_of_order",
    );
  });

  it("creates an unavailable record for a title first observed missing", () => {
    const t = applyObservation(undefined, undefined, missing(0));
    expect(t.record).toMatchObject({
      status: "unavailable",
      consecutiveMissing: 1,
      lastSuccessfulRefreshAt: null,
    });
  });

  it("records nothing for an error on an unknown title", () => {
    const t = applyObservation(undefined, undefined, {
      titleId: 1,
      runId: "r",
      at: T0,
      result: "error",
    });
    expect(t).toEqual({
      record: undefined,
      changed: false,
      event: "error_no_change",
    });
  });
});

describe("isSourceIdCollision", () => {
  const dune = { title: "Dune", releaseYear: 1984 };
  it.each([
    [{ title: "Other Film", releaseYear: 2010 }, true],
    [{ title: "Dune", releaseYear: 2010 }, false], // same title: date correction
    [{ title: "Other Film", releaseYear: 1985 }, false], // within a year: rename
    [{ title: "DÚNE!", releaseYear: 1990 }, false], // same title key
    [{ title: "Other Film", releaseYear: null }, false], // unknown year: no claim
  ])("%o -> %s", (observed, expected) => {
    expect(isSourceIdCollision(dune, observed)).toBe(expected);
  });
  it("needs a stored identity", () => {
    expect(isSourceIdCollision(undefined, dune)).toBe(false);
  });
});

describe("applyObservations (service)", () => {
  it("handles a partial batch outage: errors leave titles untouched", async () => {
    const { repo, records } = createMemoryLifecycleRepository();
    await applyObservations(
      repo,
      [1, 2, 3, 4].map((id) => ({
        titleId: id,
        runId: "run-0",
        at: day(0),
        result: "found" as const,
        identity: { title: `T${id}`, releaseYear: 2000 },
      })),
    );
    const before = structuredClone([...records.values()]);

    const report = await applyObservations(repo, [
      { titleId: 1, runId: "run-1", at: day(1), result: "error" },
      { titleId: 2, runId: "run-1", at: day(1), result: "error" },
      { titleId: 3, runId: "run-1", at: day(1), result: "missing" },
      {
        titleId: 4,
        runId: "run-1",
        at: day(1),
        result: "found",
        identity: { title: "T4", releaseYear: 2000 },
      },
    ]);
    expect(report).toMatchObject({
      observations: 4,
      unchangedOnError: 2,
      byEvent: { error_no_change: 2, became_unavailable: 1, seen: 1 },
      statusCounts: { active: 3, unavailable: 1, tombstoned: 0 },
      actions: [],
    });
    expect(records.get(1)).toEqual(before[0]);
    expect(records.get(2)).toEqual(before[1]);
  });

  it("is idempotent when a whole run is replayed", async () => {
    const { repo, records } = createMemoryLifecycleRepository();
    const run: Observation[] = [
      {
        titleId: 1,
        runId: "run-0",
        at: day(0),
        result: "found",
        identity: { title: "A", releaseYear: 2000 },
      },
      { titleId: 2, runId: "run-0", at: day(0), result: "missing" },
    ];
    await applyObservations(repo, run);
    const snapshot = structuredClone([...records.entries()]);
    const replay = await applyObservations(repo, run);
    expect(replay.byEvent).toEqual({ ignored_duplicate_run: 2 });
    expect([...records.entries()]).toEqual(snapshot);
  });

  it("gives the same result regardless of observation order", async () => {
    const obs: Observation[] = [
      ...observationsFor(SCENARIOS[2]!, 1),
      ...observationsFor(SCENARIOS[4]!, 2),
      ...observationsFor(SCENARIOS[6]!, 3),
    ];
    const identities = new Map([
      [1, SCENARIOS[2]!.stored],
      [2, SCENARIOS[4]!.stored],
      [3, SCENARIOS[6]!.stored],
    ]);
    const a = createMemoryLifecycleRepository(identities);
    const b = createMemoryLifecycleRepository(identities);
    const reportA = await applyObservations(a.repo, obs);
    const reportB = await applyObservations(b.repo, [...obs].reverse());
    expect(reportB).toEqual(reportA);
    expect([...b.records.entries()].sort()).toEqual(
      [...a.records.entries()].sort(),
    );
    // Titles 1 and 2 are both tombstoned during the batch (2 is later restored).
    expect(reportA.newlyTombstoned).toEqual({
      source_deleted: 2,
      source_id_collision: 1,
    });
    expect(reportA.restored).toBe(1);
    expect(reportA.actions).toEqual([
      {
        type: "create_new_title",
        replacesTitleId: 3,
        identity: { title: "Midnight Garden", releaseYear: 2011 },
      },
    ]);
  });
});

describe("presentableAvailability", () => {
  const offers = [{ providerId: 8 }];
  it("shows offers only while fresh", () => {
    expect(
      presentableAvailability(
        offers,
        day(0),
        new Date(day(0).getTime() + 47 * 3_600_000),
      ),
    ).toMatchObject({ state: "current", offers });
    expect(
      presentableAvailability(
        offers,
        day(0),
        new Date(day(0).getTime() + 49 * 3_600_000),
      ),
    ).toEqual({ state: "stale", offers: [], checkedAt: day(0) });
    expect(presentableAvailability(offers, null, day(0))).toEqual({
      state: "unknown",
      offers: [],
      checkedAt: null,
    });
  });
});

describe("purgeEligibility", () => {
  const tombstoned: LifecycleRecord = {
    titleId: 1,
    status: "tombstoned",
    firstSeenAt: day(0),
    lastSeenAt: day(0),
    lastSuccessfulRefreshAt: day(0),
    lastObservedAt: day(10),
    lastObservationRunId: "r",
    missingSince: day(1),
    consecutiveMissing: 3,
    tombstonedAt: day(10),
    tombstoneReason: "source_deleted",
    restoredAt: null,
    restoreCount: 0,
  };

  it("is a policy output: tombstoned, retention elapsed, and no feedback references", () => {
    expect(
      purgeEligibility(
        { ...tombstoned, status: "active", tombstonedAt: null },
        0,
        day(400),
      ),
    ).toMatchObject({ eligible: false, reason: "not_tombstoned" });
    expect(purgeEligibility(tombstoned, null, day(400))).toMatchObject({
      eligible: false,
      reason: "feedback_references_unknown",
    });
    expect(purgeEligibility(tombstoned, 2, day(400))).toMatchObject({
      eligible: false,
      reason: "has_feedback_references",
    });
    expect(purgeEligibility(tombstoned, 0, day(100))).toEqual({
      eligible: false,
      reason: "retention_pending",
      eligibleAt: day(190),
    });
    expect(purgeEligibility(tombstoned, 0, day(190))).toEqual({
      eligible: true,
      eligibleSince: day(190),
    });
  });

  it("never presents non-active titles", () => {
    expect(isPresentable(undefined)).toBe(true);
    expect(isPresentable(tombstoned)).toBe(false);
    expect(isPresentable({ ...tombstoned, status: "unavailable" })).toBe(false);
  });
});
