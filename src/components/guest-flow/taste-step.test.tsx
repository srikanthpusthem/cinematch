import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QUIZ_SEEDS } from "@/lib/guest-flow/fixtures";
import {
  AVOIDABLE_GENRES,
  EMPTY_ANSWERS,
  type GuestAnswers,
  type SeedTitle,
} from "@/lib/guest-flow/types";
import { filterQuizSeeds, TasteStep } from "./taste-step";

const seedsWithMixedPosters: SeedTitle[] = [
  {
    role: "seed",
    id: "seed-with-poster",
    title: "Has Poster",
    year: 2020,
    genres: ["Comedy"],
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%23000%27/%3E%3C/svg%3E",
  },
  {
    role: "seed",
    id: "seed-missing-poster",
    title: "Missing Poster",
    year: 2021,
    genres: ["Drama"],
    posterUrl: null,
  },
];

function renderStep(
  answers: GuestAnswers = EMPTY_ANSWERS,
  extras: Partial<Parameters<typeof TasteStep>[0]> = {},
) {
  return renderToStaticMarkup(
    <TasteStep
      answers={answers}
      error={null}
      onToggleSeed={() => undefined}
      onToggleGenre={() => undefined}
      onSkip={() => undefined}
      onBack={() => undefined}
      onContinue={() => undefined}
      canContinue={true}
      {...extras}
    />,
  );
}

describe("filterQuizSeeds", () => {
  it("filters fixture titles by title or year", () => {
    expect(filterQuizSeeds(QUIZ_SEEDS, "budapest").map((s) => s.id)).toEqual([
      "seed-budapest",
    ]);
    expect(filterQuizSeeds(QUIZ_SEEDS, "2015").map((s) => s.id)).toEqual([
      "seed-mad-max",
    ]);
    expect(filterQuizSeeds(QUIZ_SEEDS, "  ").length).toBe(QUIZ_SEEDS.length);
  });
});

describe("TasteStep", () => {
  it("labels titles as taste seeds, not recommendations", () => {
    const html = renderStep();
    expect(html).toContain("Quiz seeds, not recommendations");
    expect(html).toContain("Taste seed");
    expect(html).toContain("Taste seed titles");
    expect(html).not.toMatch(/>Recommendations</);
  });

  it("renders searchable fixture seeds as a visual multi-select grid", () => {
    const html = renderStep();
    expect(html).toContain("Search taste seeds");
    expect(html).toContain('type="search"');
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("min-h-11");
    expect(html).toContain("touch-manipulation");
    for (const seed of QUIZ_SEEDS) {
      expect(html).toContain(`value="${seed.id}"`);
      expect(html).toContain(seed.title);
    }
  });

  it("shows missing-poster fallback when posterUrl is null", () => {
    const html = renderStep(EMPTY_ANSWERS, { seeds: seedsWithMixedPosters });
    expect(html).toContain('data-testid="poster-fallback-seed-missing-poster"');
    expect(html).toContain("No poster");
    expect(html).toContain('data-testid="poster-image-seed-with-poster"');
  });

  it("exposes loading, empty catalog, and error catalog states", () => {
    const loading = renderStep(EMPTY_ANSWERS, { catalogStatus: "loading" });
    expect(loading).toContain("Loading taste seeds");
    expect(loading).not.toContain('name="taste-seeds"');

    const empty = renderStep(EMPTY_ANSWERS, { catalogStatus: "empty" });
    expect(empty).toContain("No taste seeds are available");
    expect(empty).toContain("Skip for a cold start");

    const errored = renderStep(EMPTY_ANSWERS, {
      catalogStatus: "error",
      catalogErrorMessage: "Fixture catalog failed.",
    });
    expect(errored).toContain('role="alert"');
    expect(errored).toContain("Fixture catalog failed.");
    expect(errored).toContain("Skip taste quiz");
  });

  it("shows selected and unselected text without color alone", () => {
    const html = renderStep({
      ...EMPTY_ANSWERS,
      seedIds: ["seed-budapest"],
    });
    expect(html).toContain("Selected · taste seed");
    expect(html).toContain("Not selected");
    expect(html).toContain("✓");
  });

  it("renders editable avoided genres", () => {
    const html = renderStep({
      ...EMPTY_ANSWERS,
      avoidedGenres: ["Horror"],
    });
    for (const genre of AVOIDABLE_GENRES) {
      expect(html).toContain(`value="${genre}"`);
    }
    expect(html).toContain("Genres to avoid");
    expect(html).toMatch(
      /value="Horror"[^>]*checked(?:="")?|checked(?:="")?[^>]*value="Horror"/,
    );
  });

  it("disables Continue when selection count is invalid", () => {
    const blocked = renderStep(
      { ...EMPTY_ANSWERS, seedIds: ["seed-budapest"] },
      {
        error: "Choose 3 to 5 quiz titles, or skip.",
        canContinue: false,
      },
    );
    expect(blocked).toMatch(
      /<button[^>]*\sdisabled(?:="")?[^>]*>Continue<\/button>/,
    );
    expect(blocked).toContain("Choose 3 to 5 quiz titles, or skip.");

    const ready = renderStep(
      {
        ...EMPTY_ANSWERS,
        seedIds: ["seed-budapest", "seed-parks", "seed-booksmart"],
      },
      { canContinue: true },
    );
    const continueOpen = ready.match(/<button\b[^>]*>Continue<\/button>/)?.[0];
    expect(continueOpen).toBeTruthy();
    expect(continueOpen).not.toMatch(/\sdisabled(?:="")?(?=\s|>)/);
  });

  it("explains skip as zero-seed cold start", () => {
    const idle = renderStep();
    expect(idle).toContain("Skip taste quiz");
    expect(idle).toContain("cold start");

    const skipped = renderStep({
      ...EMPTY_ANSWERS,
      tasteSkipped: true,
    });
    expect(skipped).toContain(
      "Taste quiz skipped · cold start with zero seeds.",
    );
  });

  it("accepts toggle and navigation callbacks without throwing", () => {
    const onToggleSeed = vi.fn();
    const onToggleGenre = vi.fn();
    const onSkip = vi.fn();
    const onBack = vi.fn();
    const onContinue = vi.fn();
    expect(() =>
      renderToStaticMarkup(
        <TasteStep
          answers={EMPTY_ANSWERS}
          error={null}
          onToggleSeed={onToggleSeed}
          onToggleGenre={onToggleGenre}
          onSkip={onSkip}
          onBack={onBack}
          onContinue={onContinue}
          canContinue={true}
        />,
      ),
    ).not.toThrow();
    expect(onToggleSeed).not.toHaveBeenCalled();
    expect(onToggleGenre).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
