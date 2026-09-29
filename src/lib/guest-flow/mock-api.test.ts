import { describe, expect, it, vi } from "vitest";
import { CATALOG, QUIZ_SEEDS } from "./fixtures";
import { matchingSeedGenre, mockRecommend } from "./mock-api";
import { EMPTY_ANSWERS, tasteSelectionError, type GuestAnswers } from "./types";

const coldComfortMovies: GuestAnswers = {
  ...EMPTY_ANSWERS,
  servicesSkipped: true,
  tasteSkipped: true,
  mood: "comfort",
  format: "movie",
  movieLength: "any",
};

describe("tasteSelectionError", () => {
  it("allows zero or 3 to 5 titles", () => {
    expect(tasteSelectionError(0)).toBeNull();
    expect(tasteSelectionError(3)).toBeNull();
    expect(tasteSelectionError(5)).toBeNull();
  });

  it("rejects one, two, or more than five titles", () => {
    expect(tasteSelectionError(1)).toMatch(/3 to 5/);
    expect(tasteSelectionError(2)).toMatch(/3 to 5/);
    expect(tasteSelectionError(6)).toMatch(/at most 5/);
  });
});

describe("matchingSeedGenre", () => {
  it("returns the shared genre used by eligibility and reason text", () => {
    const title = CATALOG.find((item) => item.title === "About Time");
    expect(title).toBeDefined();
    if (!title) return;
    expect(
      matchingSeedGenre(title, {
        ...coldComfortMovies,
        tasteSkipped: false,
        seedIds: ["seed-budapest", "seed-parks", "seed-booksmart"],
      }),
    ).toBe("Comedy");
  });

  it("returns undefined when no quiz seeds were chosen", () => {
    const title = CATALOG.find((item) => item.title === "About Time");
    expect(title).toBeDefined();
    if (!title) return;
    expect(matchingSeedGenre(title, coldComfortMovies)).toBeUndefined();
  });
});

describe("mockRecommend", () => {
  it("returns a cold-start best match and four alternatives", async () => {
    const result = await mockRecommend(coldComfortMovies);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.confidence).toBe("cold-start");
    expect(result.best.role).toBe("recommendation");
    expect(result.best.title).toBe("About Time");
    expect(result.best.reason).toMatch(/Cold start/);
    expect(result.best.reason).toMatch(/taste quiz was skipped/);
    expect(result.best.reason).toMatch(/Included with Prime Video/);
    expect(result.alternatives).toHaveLength(4);
    expect(result.alternatives.map((pick) => pick.title)).toEqual([
      "Hunt for the Wilderpeople",
      "Paddington 2",
      "Safety Not Guaranteed",
      "School of Rock",
    ]);
    const titles = [result.best, ...result.alternatives].map(
      (pick) => pick.title,
    );
    expect(
      titles.some((title) => QUIZ_SEEDS.some((seed) => seed.title === title)),
    ).toBe(false);
  });

  it("distinguishes skipped quiz from continuing with zero titles", async () => {
    const skipped = await mockRecommend(coldComfortMovies);
    expect(skipped.status).toBe("ok");
    if (skipped.status === "ok") {
      expect(skipped.best.reason).toMatch(/taste quiz was skipped/);
    }

    const choseNone = await mockRecommend({
      ...coldComfortMovies,
      tasteSkipped: false,
    });
    expect(choseNone.status).toBe("ok");
    if (choseNone.status === "ok") {
      expect(choseNone.best.reason).toMatch(/no quiz titles were chosen/);
      expect(choseNone.best.reason).not.toMatch(/taste quiz was skipped/);
    }
  });

  it("grounds seeded picks in shared quiz genres", async () => {
    const result = await mockRecommend({
      ...coldComfortMovies,
      tasteSkipped: false,
      seedIds: ["seed-budapest", "seed-parks", "seed-booksmart"],
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.confidence).toBe("seeded");
    expect(result.best.reason).toMatch(/Shares Comedy with a quiz seed/);
  });

  it("does not relax filters when only a shortage remains", async () => {
    const result = await mockRecommend({
      ...coldComfortMovies,
      movieLength: "under-100",
    });
    expect(result.status).toBe("shortage");
    if (result.status !== "shortage") return;
    expect(result.best.title).toBe("Hunt for the Wilderpeople");
    expect(result.alternatives.map((pick) => pick.title)).toEqual([
      "Safety Not Guaranteed",
    ]);
    expect(result.message).toMatch(/Only 2 matches fit/);
    expect(result.message).toMatch(/Nothing was added/);
  });

  it("returns empty instead of inventing an incompatible title", async () => {
    const result = await mockRecommend({
      ...EMPTY_ANSWERS,
      serviceIds: ["peacock"],
      mood: "think",
      format: "movie",
      movieLength: "epic",
    });
    expect(result).toMatchObject({ status: "empty" });
  });

  it("keeps rent separate from a subscription", async () => {
    const result = await mockRecommend({
      ...EMPTY_ANSWERS,
      servicesSkipped: true,
      tasteSkipped: true,
      mood: "think",
      format: "movie",
      movieLength: "epic",
    });
    expect(result.status).toBe("shortage");
    if (result.status !== "shortage") return;
    expect(result.best.title).toBe("Blade Runner 2049");
    expect(result.best.offers).toEqual([
      { serviceId: "apple", serviceName: "Apple TV+", access: "subscription" },
      { serviceId: "prime", serviceName: "Prime Video", access: "rent" },
    ]);
    expect(result.best.reason).toMatch(/Included with Apple TV\+/);
    expect(result.best.reason).not.toMatch(/Included with Prime Video/);
  });

  it("forces empty, shortage, and error modes without new titles", async () => {
    const empty = await mockRecommend(coldComfortMovies, { mode: "empty" });
    expect(empty.status).toBe("empty");
    const shortage = await mockRecommend(coldComfortMovies, {
      mode: "shortage",
    });
    expect(shortage.status).toBe("shortage");
    if (shortage.status === "shortage") {
      expect([shortage.best, ...shortage.alternatives]).toHaveLength(2);
    }
    const error = await mockRecommend(coldComfortMovies, { mode: "error" });
    expect(error).toEqual({
      status: "error",
      message:
        "The mock picker failed before choosing titles. No picks were invented.",
    });
  });

  it("rejects an unfinished taste selection", async () => {
    const result = await mockRecommend({
      ...coldComfortMovies,
      seedIds: ["seed-budapest", "seed-parks"],
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/3 to 5/);
    }
  });

  it("aborts immediately when AbortSignal fires during delay", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = mockRecommend(coldComfortMovies, {
        delayMs: 500,
        signal: controller.signal,
      });
      const outcome = pending.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );

      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);

      const settled = await outcome;
      expect(settled.status).toBe("rejected");
      if (settled.status !== "rejected") return;
      expect(settled.reason).toBeInstanceOf(DOMException);
      expect((settled.reason as DOMException).name).toBe("AbortError");
    } finally {
      vi.useRealTimers();
    }
  });
});
