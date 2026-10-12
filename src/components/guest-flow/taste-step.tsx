"use client";

import Image from "next/image";
import { catalogPosterUrl } from "@/lib/catalog-image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  loadQuizSeeds,
  searchCatalog,
  type CatalogOptions,
  type CatalogTitle,
} from "@/lib/guest-flow/catalog-client";
import { type AvoidableGenre, type GuestAnswers } from "@/lib/guest-flow/types";
import { PosterPlaceholder, StepHeader } from "./ui";

type CatalogPhase =
  | { type: "loading" }
  | { type: "ready"; titles: CatalogTitle[]; hasMore?: boolean }
  | { type: "error"; message: string };

type SearchPhase = CatalogPhase | { type: "idle" };

export function TasteStep({
  answers,
  genres,
  error,
  onToggleSeed,
  onToggleGenre,
  onSkip,
  onBack,
  onContinue,
  canContinue,
}: {
  answers: GuestAnswers;
  genres: CatalogOptions["genres"];
  error: string | null;
  onToggleSeed: (id: string) => void;
  onToggleGenre: (genre: AvoidableGenre) => void;
  onSkip: () => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const [seeds, setSeeds] = useState<CatalogPhase>({ type: "loading" });
  const [retry, setRetry] = useState(0);
  const [quizExpanded, setQuizExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchPhase>({ type: "idle" });
  const [knownTitles, setKnownTitles] = useState<Record<string, CatalogTitle>>(
    {},
  );
  const searchRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadQuizSeeds({ signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setSeeds({ type: "ready", titles: page.results });
        setKnownTitles((known) => ({
          ...known,
          ...Object.fromEntries(page.results.map((title) => [title.id, title])),
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSeeds({
            type: "error",
            message:
              "Quiz titles could not be loaded. Try again, search for a favorite, or skip.",
          });
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => () => searchRequest.current?.abort(), []);

  function changeQuery(value: string) {
    searchRequest.current?.abort();
    setQuery(value);
    setSearch({ type: "idle" });
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearch({ type: "loading" });
    try {
      const page = await searchCatalog(query, { signal: controller.signal });
      if (controller.signal.aborted || searchRequest.current !== controller)
        return;
      setSearch({
        type: "ready",
        titles: page.results,
        hasMore: page.nextCursor !== null,
      });
      setKnownTitles((known) => ({
        ...known,
        ...Object.fromEntries(page.results.map((title) => [title.id, title])),
      }));
    } catch {
      if (!controller.signal.aborted && searchRequest.current === controller) {
        setSearch({
          type: "error",
          message:
            "Search is unavailable. Try again or use the quiz titles below.",
        });
      }
    }
  }

  const titles =
    search.type === "ready"
      ? search.titles
      : seeds.type === "ready"
        ? seeds.titles
        : [];
  const visibleTitles =
    search.type === "ready" || quizExpanded ? titles : titles.slice(0, 6);
  return (
    <section className="flow-step" aria-labelledby="taste-heading">
      <StepHeader
        id="taste-heading"
        eyebrow="Tell us what you love"
        title="Optional taste quiz"
      >
        <p>
          Pick 3 to 5 favorites, or keep going without them. Quiz seeds, not
          recommendations. No need to choose something you haven’t seen.
        </p>
      </StepHeader>
      <form
        className="favorite-search"
        onSubmit={(event) => void submitSearch(event)}
      >
        <label htmlFor="favorite-search" className="text-sm font-medium">
          Search for a favorite
        </label>
        <input
          id="favorite-search"
          type="search"
          name="favorite-search"
          autoComplete="off"
          placeholder="A movie or series you love…"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          minLength={2}
          maxLength={100}
          className="search-input"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={query.trim().length < 2}
            className="button-secondary"
          >
            Search titles
          </button>
          {query || search.type !== "idle" ? (
            <button
              type="button"
              onClick={() => changeQuery("")}
              className="button-text"
            >
              Show quiz titles
            </button>
          ) : null}
        </div>
      </form>
      {seeds.type === "loading" && search.type !== "ready" ? (
        <p className="flow-notice loading-notice" role="status">
          Loading quiz titles…
        </p>
      ) : null}
      {seeds.type === "error" && search.type !== "ready" ? (
        <div className="flow-notice notice-error">
          <p role="alert">{seeds.message}</p>
          <button
            type="button"
            className="button-text"
            onClick={() => {
              setSeeds({ type: "loading" });
              setRetry((value) => value + 1);
            }}
          >
            Retry quiz titles
          </button>
        </div>
      ) : null}
      {search.type === "loading" ? (
        <p role="status" className="flow-notice loading-notice">
          Searching titles…
        </p>
      ) : null}
      {search.type === "error" ? (
        <p role="alert" className="flow-notice notice-error">
          {search.message}
        </p>
      ) : null}
      {search.type === "ready" && search.hasMore ? (
        <p className="flow-notice" role="status">
          Showing the first {search.titles.length} matches. Refine your search
          to find a different title.
        </p>
      ) : null}
      {titles.length > 0 ? (
        <fieldset className="taste-fieldset">
          <legend>
            {search.type === "ready" ? "Search results" : "Quiz seeds"}
          </legend>
          <div id="quiz-seed-grid" className="seed-grid">
            {visibleTitles.map((title) => {
              const selected = answers.seedIds.includes(title.id);
              const disabled = !selected && answers.seedIds.length >= 5;
              const posterUrl = catalogPosterUrl(title.posterPath);
              return (
                <label
                  key={title.id}
                  className="seed-card"
                  data-selected={selected}
                  data-disabled={disabled}
                >
                  <input
                    type="checkbox"
                    name="favorites"
                    value={title.id}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => onToggleSeed(title.id)}
                  />
                  <div className="seed-poster">
                    {posterUrl ? (
                      <Image
                        src={posterUrl}
                        alt=""
                        width={180}
                        height={270}
                        unoptimized
                        className="poster-image"
                      />
                    ) : (
                      <PosterPlaceholder />
                    )}
                    <span className="seed-select-mark" aria-hidden="true">
                      {selected ? "✓" : "+"}
                    </span>
                  </div>
                  <span className="seed-copy">
                    <span className="seed-title">{title.title}</span>
                    <span className="seed-meta">
                      {title.year !== null ? `${title.year} · ` : ""}
                      {title.kind === "movie" ? "Movie" : "Series"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {search.type !== "ready" && titles.length > 6 ? (
            <button
              type="button"
              className="button-text quiz-expand"
              aria-expanded={quizExpanded}
              aria-controls="quiz-seed-grid"
              onClick={() => setQuizExpanded((expanded) => !expanded)}
            >
              {quizExpanded
                ? "Show fewer quiz titles"
                : "Show more quiz titles"}
            </button>
          ) : null}
        </fieldset>
      ) : search.type === "ready" || seeds.type === "ready" ? (
        <p role="status" className="flow-notice">
          {search.type === "ready"
            ? "No matching titles. Try another search."
            : "No quiz titles are available in the catalog yet. You can continue without favorites."}
        </p>
      ) : null}
      {answers.seedIds.length > 0 ? (
        <div className="selected-favorites" aria-label="Selected favorites">
          <p className="font-medium text-sm">Your selected favorites</p>
          <ul className="favorites-list">
            {answers.seedIds.map((id) => (
              <li key={id} className="favorite-item">
                <span>
                  {knownTitles[id]?.title ?? `Saved favorite (catalog ${id})`}
                </span>
                <button
                  type="button"
                  className="button-text"
                  aria-label={`Remove ${knownTitles[id]?.title ?? `saved favorite ${id}`}`}
                  onClick={() => onToggleSeed(id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="flow-notice" role="status">
        {answers.seedIds.length} selected.{error ? ` ${error}` : null}
      </p>
      {genres.length > 0 || answers.avoidedGenres.length > 0 ? (
        <details className="genre-details">
          <summary>
            Anything you’d rather skip?
            {answers.avoidedGenres.length > 0 ? (
              <span className="genre-count">
                {answers.avoidedGenres.length} avoided
              </span>
            ) : (
              <span className="optional-label">Optional</span>
            )}
          </summary>
          <fieldset className="genre-fieldset">
            <legend className="text-sm font-medium">Genres to avoid</legend>
            {genres.map((genre) => (
              <label key={genre.id} className="genre-choice">
                <input
                  type="checkbox"
                  checked={answers.avoidedGenres.includes(genre.id)}
                  onChange={() => onToggleGenre(genre.id)}
                />
                <span className="genre-name">{genre.name}</span>
                <span className="genre-kind">
                  (
                  {genre.kinds
                    .map((kind) => (kind === "movie" ? "movies" : "series"))
                    .join(" and ")}
                  )
                </span>
              </label>
            ))}
            {answers.avoidedGenres
              .filter((id) => !genres.some((genre) => genre.id === id))
              .map((id) => (
                <label key={id} className="genre-choice">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onToggleGenre(id)}
                  />
                  Saved genre not listed (catalog {id})
                </label>
              ))}
          </fieldset>
        </details>
      ) : null}
      <div className="step-actions">
        <button
          type="button"
          className="button-primary"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
        <button type="button" className="button-secondary" onClick={onSkip}>
          Skip taste quiz
        </button>
        <button type="button" className="button-text" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
