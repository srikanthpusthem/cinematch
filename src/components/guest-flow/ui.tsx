import type { ReactNode } from "react";

export function FilmMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="26"
        height="26"
        rx="8"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m13 10 9 6-9 6V10Z" fill="currentColor" />
      <path
        d="M7 8v3m0 4v3m0 4v2m18-16v3m0 4v3m0 4v2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function StepHeader({
  eyebrow,
  title,
  children,
  id,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <header className="step-header">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      <div className="step-description">{children}</div>
    </header>
  );
}

export function PosterPlaceholder() {
  return (
    <div className="poster-placeholder" aria-hidden="true">
      <FilmMark />
      <span>CineMatch</span>
    </div>
  );
}

export function MoodIcon({ mood }: { mood: string }) {
  const paths: Record<string, string> = {
    laugh: "M8 14c1.5 3 6.5 3 8 0M8 9h.01M16 9h.01",
    cry: "M8 10h.01M16 10h.01M9 17c2-2 4-2 6 0M17 12s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z",
    thrill: "m13 3-8 10h6l-1 8 9-11h-6l0-7Z",
    think:
      "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
    comfort: "M19 14a8 8 0 0 1-9-9 8 8 0 1 0 9 9Z",
  };
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mood === "laugh" || mood === "cry" ? (
        <circle cx="12" cy="12" r="9" />
      ) : mood === "think" ? (
        <circle cx="12" cy="12" r="4" />
      ) : null}
      <path d={paths[mood] ?? paths.think} />
    </svg>
  );
}
