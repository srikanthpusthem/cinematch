import { describe, expect, it } from "vitest";
import { formatAuditSummary, type AuditReport } from "./audit";

const report = (overrides: Partial<AuditReport> = {}): AuditReport => ({
  asOf: "2026-10-01T00:00:00.000Z",
  sampleSize: 2,
  counts: {
    movies: 20_100,
    series: 4_000,
    seasons: 12_000,
    genres: 27,
    keywords: 9_000,
    providers: 80,
    offers: 50_000,
    availabilityRows: 24_000,
  },
  targets: {
    movies: { target: 20_000, actual: 20_100, met: true },
    series: { target: 5_000, actual: 4_000, met: false },
  },
  availability: {
    staleAfterHours: 48,
    neverChecked: 100,
    fresh: 23_000,
    stale: 1_000,
    ageBuckets: { upTo24h: 20_000, upTo48h: 3_000, upTo7d: 900, over7d: 100 },
    oldestFetchedAt: null,
    newestFetchedAt: null,
  },
  lifecycle: {
    unobserved: 0,
    active: 24_000,
    unavailable: 50,
    tombstoned: 50,
    tombstonedByReason: { source_deleted: 49, source_id_collision: 1 },
  },
  findings: [],
  healthy: true,
  ...overrides,
});

describe("formatAuditSummary", () => {
  it("summarizes a healthy catalog, stating which targets are met", () => {
    const text = formatAuditSummary(report());
    expect(text).toContain(
      "M1 targets: movies 20100/20000 MET, series 4000/5000 not met",
    );
    expect(text).toContain("23000 fresh, 1000 stale, 100 never checked");
    expect(text).toContain("No findings.");
    expect(text).toContain("Result: HEALTHY (no errors)");
  });

  it("lists findings with bounded samples, the remainder count and guidance", () => {
    const text = formatAuditSummary(
      report({
        healthy: false,
        findings: [
          {
            check: "season_count_mismatch",
            severity: "error",
            count: 5,
            sample: ["series:1", "series:2"],
            guidance: "Re-ingest these series.",
          },
        ],
      }),
    );
    expect(text).toContain("[ERROR] season_count_mismatch: 5");
    expect(text).toContain("sample: series:1, series:2 (+3 more)");
    expect(text).toContain("fix: Re-ingest these series.");
    expect(text).toContain("Result: ERRORS FOUND");
  });
});
