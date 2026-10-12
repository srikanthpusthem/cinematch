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
