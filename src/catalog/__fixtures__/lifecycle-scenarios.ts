// Lifecycle scenarios shared by the unit and Postgres tests. Each step is one
// refresh run's observation of a single title; `day` is days after T0.
import type {
  LifecycleEvent,
  LifecycleStatus,
  Observation,
  SourceIdentity,
  TombstoneReason,
} from "../lifecycle";

export const T0 = new Date("2026-01-01T03:00:00Z");
export const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

type Step =
  | { day: number; result: "found"; identity?: SourceIdentity }
  | { day: number; result: "missing" | "error" };

export interface Scenario {
  name: string;
  /** Identity stored in the catalog for the title. */
  stored: SourceIdentity;
  steps: Step[];
  events: LifecycleEvent[];
  final: {
    status: LifecycleStatus;
    tombstoneReason?: TombstoneReason | null;
    restoreCount?: number;
    consecutiveMissing?: number;
  };
  /** Expect a create_new_title action. */
  collision?: boolean;
}

const DUNE: SourceIdentity = { title: "Dune", releaseYear: 1984 };

export const SCENARIOS: Scenario[] = [
  {
    name: "transient 404 recovers without tombstoning",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      { day: 1, result: "missing" },
      { day: 2, result: "found" },
    ],
    events: ["first_seen", "became_unavailable", "recovered"],
    final: { status: "active", consecutiveMissing: 0, restoreCount: 0 },
  },
  {
    name: "empty responses inside a week stay unavailable",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      { day: 1, result: "missing" },
      { day: 2, result: "missing" },
      { day: 3, result: "missing" },
    ],
    events: [
      "first_seen",
      "became_unavailable",
      "still_unavailable",
      "still_unavailable",
    ],
    final: { status: "unavailable", consecutiveMissing: 3 },
  },
  {
    name: "sustained deletion tombstones after 3 misses over 7+ days",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      { day: 1, result: "missing" },
      { day: 4, result: "missing" },
      { day: 8, result: "missing" },
    ],
    events: [
      "first_seen",
      "became_unavailable",
      "still_unavailable",
      "tombstoned",
    ],
    final: { status: "tombstoned", tombstoneReason: "source_deleted" },
  },
  {
    name: "two misses far apart are not enough",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      { day: 1, result: "missing" },
      { day: 20, result: "missing" },
    ],
    events: ["first_seen", "became_unavailable", "still_unavailable"],
    final: { status: "unavailable", consecutiveMissing: 2 },
  },
  {
    name: "restore after tombstone keeps the title and counts the restore",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      { day: 1, result: "missing" },
      { day: 4, result: "missing" },
      { day: 8, result: "missing" },
      { day: 9, result: "missing" },
      { day: 30, result: "found" },
    ],
    events: [
      "first_seen",
      "became_unavailable",
      "still_unavailable",
      "tombstoned",
      "still_tombstoned",
      "restored",
    ],
    final: {
      status: "active",
      tombstoneReason: null,
      restoreCount: 1,
      consecutiveMissing: 0,
    },
  },
  {
    name: "outages never change state",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      { day: 1, result: "error" },
      { day: 2, result: "error" },
      { day: 3, result: "error" },
      { day: 10, result: "error" },
    ],
    events: [
      "first_seen",
      "error_no_change",
      "error_no_change",
      "error_no_change",
      "error_no_change",
    ],
    final: { status: "active", consecutiveMissing: 0 },
  },
  {
    name: "source id reused for a different work",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      {
        day: 5,
        result: "found",
        identity: { title: "Midnight Garden", releaseYear: 2011 },
      },
    ],
    events: ["first_seen", "source_id_collision"],
    final: { status: "tombstoned", tombstoneReason: "source_id_collision" },
    collision: true,
  },
  {
    name: "a rename or a date fix alone is not a collision",
    stored: DUNE,
    steps: [
      { day: 0, result: "found" },
      {
        day: 1,
        result: "found",
        identity: { title: "Dune (1984)", releaseYear: 1984 },
      },
      {
        day: 2,
        result: "found",
        identity: { title: "DUNE", releaseYear: 1986 },
      },
    ],
    events: ["first_seen", "seen", "seen"],
    final: { status: "active" },
  },
];

/** Observations for a scenario (runId per day, so replays are identifiable). */
export function observationsFor(
  scenario: Scenario,
  titleId: number,
): Observation[] {
  return scenario.steps.map((s) => {
    const base = { titleId, runId: `run-${s.day}`, at: day(s.day) };
    return s.result === "found"
      ? { ...base, result: "found", identity: s.identity ?? scenario.stored }
      : { ...base, result: s.result };
  });
}
