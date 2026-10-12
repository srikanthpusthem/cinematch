import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_ANSWERS, MOODS } from "@/lib/guest-flow/types";
import { TonightStep } from "./tonight-step";
import { FilmMark, MoodIcon, PosterPlaceholder, StepHeader } from "./ui";

const noop = () => undefined;

describe("cinematic UI semantics", () => {
  it("uses decorative SVG mood illustrations without platform-dependent emoji", () => {
    for (const mood of MOODS) {
      const html = renderToStaticMarkup(<MoodIcon mood={mood.id} />);
      expect(html).toContain("<svg");
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).not.toContain("✳");
    }
  });
  it("keeps visual marks decorative and placeholders free of invented titles", () => {
    const mark = renderToStaticMarkup(<FilmMark />);
    expect(mark).toContain('aria-hidden="true"');
    const placeholder = renderToStaticMarkup(<PosterPlaceholder />);
    expect(placeholder).toContain('aria-hidden="true"');
    expect(placeholder).toContain("CineMatch");
    expect(placeholder).not.toContain("img");
  });

  it("preserves step heading IDs and a separate descriptive paragraph", () => {
    const html = renderToStaticMarkup(
      <StepHeader
        id="taste-heading"
        eyebrow="Your kind of story"
        title="Optional taste quiz"
      >
        <p>Quiz seeds, not recommendations.</p>
      </StepHeader>,
    );
    expect(html).toContain('<h2 id="taste-heading">Optional taste quiz</h2>');
    expect(html).toContain("Quiz seeds, not recommendations.");
  });

  it("keeps mood cards native labelled radios with a checked state", () => {
    const html = renderToStaticMarkup(
      <TonightStep
        answers={{ ...EMPTY_ANSWERS, mood: "think" }}
        onChange={noop}
        onBack={noop}
        onContinue={noop}
        canContinue={false}
      />,
    );
    for (const mood of MOODS) {
      expect(html).toContain(`value="${mood.id}"`);
      expect(html).toContain(mood.label);
    }
    expect(html.match(/name="mood"/g)).toHaveLength(MOODS.length);
    expect(html).toContain('data-selected="true"');
    const selectedRadio = html.match(/<input[^>]*value="think"[^>]*>/)?.[0];
    expect(selectedRadio).toContain('type="radio"');
    expect(selectedRadio).toContain('name="mood"');
    expect(selectedRadio).toContain('checked=""');
    expect(html).toContain('aria-labelledby="tonight-heading"');
  });

  it("keeps exact movie length boundaries visible on the visual cards", () => {
    const html = renderToStaticMarkup(
      <TonightStep
        answers={{ ...EMPTY_ANSWERS, format: "movie", movieLength: "epic" }}
        onChange={noop}
        onBack={noop}
        onContinue={noop}
        canContinue={false}
      />,
    );
    expect(html).toContain("99 minutes or less");
    expect(html).toContain("150 minutes or more");
    expect(html).toContain("No runtime limit");
  });
});
