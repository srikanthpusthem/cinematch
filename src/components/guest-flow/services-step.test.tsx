import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_ANSWERS,
  SERVICE_OPTIONS,
  type GuestAnswers,
} from "@/lib/guest-flow/types";
import { isServiceSelected, ServicesStep } from "./services-step";

function renderStep(answers: GuestAnswers = EMPTY_ANSWERS) {
  return renderToStaticMarkup(
    <ServicesStep
      answers={answers}
      onToggle={() => undefined}
      onSkip={() => undefined}
      onContinue={() => undefined}
      canContinue={answers.servicesSkipped || answers.serviceIds.length > 0}
    />,
  );
}

describe("isServiceSelected", () => {
  it("is false when services were skipped", () => {
    const answers: GuestAnswers = {
      ...EMPTY_ANSWERS,
      serviceIds: ["netflix"],
      servicesSkipped: true,
    };
    expect(isServiceSelected(answers, "netflix")).toBe(false);
  });

  it("is true only for chosen subscription ids", () => {
    const answers: GuestAnswers = {
      ...EMPTY_ANSWERS,
      serviceIds: ["netflix", "hulu"],
    };
    expect(isServiceSelected(answers, "netflix")).toBe(true);
    expect(isServiceSelected(answers, "max")).toBe(false);
  });
});

describe("ServicesStep", () => {
  it("renders every SERVICE_OPTIONS entry as a checkbox", () => {
    const html = renderStep();
    for (const service of SERVICE_OPTIONS) {
      expect(html).toContain(`value="${service.id}"`);
      expect(html).toContain(service.name);
    }
    expect(html.match(/type="checkbox"/g)?.length).toBe(SERVICE_OPTIONS.length);
  });

  it("exposes selected and unselected text without relying on color alone", () => {
    const html = renderStep({
      ...EMPTY_ANSWERS,
      serviceIds: ["netflix"],
    });
    expect(html).toContain("Selected · subscription");
    expect(html).toContain("Not selected");
    expect(html).toContain("✓");
  });

  it("explains subscription vs rent/buy and skip-all meaning", () => {
    const idle = renderStep();
    expect(idle).toContain("subscription access only");
    expect(idle).toContain("Rent and buy");
    expect(idle).toContain("Skip, show all services");

    const skipped = renderStep({
      ...EMPTY_ANSWERS,
      servicesSkipped: true,
    });
    expect(skipped).toContain("Showing every service");
    expect(skipped).toContain("not free");
    expect(skipped).not.toContain('checked=""');
    expect(skipped).not.toContain("checked={true}");
  });

  it("uses a multi-select grid and large touch targets", () => {
    const html = renderStep();
    expect(html).toContain("grid");
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("min-h-11");
    expect(html).toContain("touch-manipulation");
  });

  it("disables Continue until a service is chosen", () => {
    const blocked = renderStep(EMPTY_ANSWERS);
    expect(blocked).toMatch(
      /<button[^>]*\sdisabled(?:="")?[^>]*>Continue<\/button>/,
    );

    const ready = renderStep({
      ...EMPTY_ANSWERS,
      serviceIds: ["prime"],
    });
    const continueOpen = ready.match(/<button\b[^>]*>Continue<\/button>/)?.[0];
    expect(continueOpen).toBeTruthy();
    expect(continueOpen).not.toMatch(/\sdisabled(?:="")?(?=\s|>)/);
  });

  it("wires toggle and skip callbacks", () => {
    const onToggle = vi.fn();
    const onSkip = vi.fn();
    const onContinue = vi.fn();
    // Static markup cannot fire events; assert props are accepted without throw.
    expect(() =>
      renderToStaticMarkup(
        <ServicesStep
          answers={EMPTY_ANSWERS}
          onToggle={onToggle}
          onSkip={onSkip}
          onContinue={onContinue}
          canContinue={false}
        />,
      ),
    ).not.toThrow();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
