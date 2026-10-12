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
  return (
    <section className="mt-8" aria-labelledby="taste-heading">
      <h2 id="taste-heading" className="text-xl font-semibold">
        Optional taste quiz
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Quiz seeds, not recommendations. Pick 3 to 5 favorites, or continue with
        none. You do not have to choose unfamiliar titles.
      </p>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(event) => void submitSearch(event)}
      >
        <label htmlFor="favorite-search" className="text-sm font-medium">
          Search for a favorite
        </label>
        <input
          id="favorite-search"
          type="search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          minLength={2}
          maxLength={100}
          className="min-h-11 rounded-lg border border-zinc-300 px-3 dark:border-zinc-700"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={query.trim().length < 2}
            className="min-h-11 rounded-lg border px-4 disabled:opacity-40"
          >
            Search titles
          </button>
          {query || search.type !== "idle" ? (
            <button
              type="button"
              onClick={() => changeQuery("")}
              className="min-h-11 px-4"
            >
              Show quiz titles
            </button>
          ) : null}
        </div>
      </form>
      {seeds.type === "loading" && search.type !== "ready" ? (
        <p className="mt-3" role="status">
          Loading quiz titles…
        </p>
      ) : null}
      {seeds.type === "error" && search.type !== "ready" ? (
        <div className="mt-3">
          <p role="alert">{seeds.message}</p>
          <button
            type="button"
            className="min-h-11 px-4"
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
        <p role="status" className="mt-3">
          Searching titles…
        </p>
      ) : null}
      {search.type === "error" ? (
        <p role="alert" className="mt-3">
          {search.message}
        </p>
      ) : null}
      {search.type === "ready" && search.hasMore ? (
        <p className="mt-3 text-sm" role="status">
          Showing the first {search.titles.length} matches. Refine your search
          to find a different title.
        </p>
      ) : null}
      {titles.length > 0 ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-medium">
            {search.type === "ready" ? "Search results" : "Quiz seeds"}
          </legend>
          {titles.map((title) => (
            <label
              key={title.id}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <input
                type="checkbox"
                checked={answers.seedIds.includes(title.id)}
                disabled={
                  !answers.seedIds.includes(title.id) &&
                  answers.seedIds.length >= 5
                }
                onChange={() => onToggleSeed(title.id)}
              />
              {catalogPosterUrl(title.posterPath) ? (
                <Image
                  src={catalogPosterUrl(title.posterPath)!}
                  alt=""
                  width={40}
                  height={60}
                  unoptimized
                  className="rounded object-cover"
                />
              ) : null}
              <span>
                {title.title}
                {title.year !== null ? (
                  <span className="text-zinc-500"> ({title.year})</span>
                ) : null}
                <span className="block text-xs text-zinc-500">
                  {title.kind === "movie" ? "Movie" : "Series"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : search.type === "ready" || seeds.type === "ready" ? (
        <p role="status" className="mt-4">
          {search.type === "ready"
            ? "No matching titles. Try another search."
            : "No quiz titles are available in the catalog yet. You can continue without favorites."}
        </p>
      ) : null}
      {answers.seedIds.length > 0 ? (
        <div className="mt-4" aria-label="Selected favorites">
          <p className="font-medium text-sm">Your selected favorites</p>
          <ul className="mt-2 space-y-2">
            {answers.seedIds.map((id) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <span>
                  {knownTitles[id]?.title ?? `Saved favorite (catalog ${id})`}
                </span>
                <button
                  type="button"
                  className="min-h-11 px-3"
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
      <p className="mt-3 text-sm" role="status">
        {answers.seedIds.length} selected.{error ? ` ${error}` : null}
      </p>
      {genres.length > 0 || answers.avoidedGenres.length > 0 ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-medium">Genres to avoid</legend>
          {genres.map((genre) => (
            <label key={genre.id} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={answers.avoidedGenres.includes(genre.id)}
                onChange={() => onToggleGenre(genre.id)}
              />
              {genre.name}{" "}
              <span className="text-xs text-zinc-500">
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
              <label key={id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked
                  onChange={() => onToggleGenre(id)}
                />
                Saved genre not listed (catalog {id})
              </label>
            ))}
        </fieldset>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg bg-zinc-950 px-4 text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-zinc-300 px-4 dark:border-zinc-700"
          onClick={onSkip}
        >
          Skip taste quiz
        </button>
        <button
          type="button"
          className="min-h-11 px-4 text-left"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </section>
  );
}
