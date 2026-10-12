import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  JUSTWATCH_ATTRIBUTION,
  TMDB_LOGO,
  TMDB_NOTICE,
  TMDB_URL,
} from "@/catalog/attribution";

export const metadata: Metadata = {
  title: "About & credits · CineMatch",
};

// Credits required by TMDB (About/Credits placement, notice, logo less
// prominent than ours) and JustWatch (source of availability data).
export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        About &amp; credits
      </h1>
      <p className="mt-4 text-zinc-700 dark:text-zinc-300">
        CineMatch helps you pick a movie or series to watch tonight.
      </p>

      <section aria-labelledby="data-sources" className="mt-10">
        <h2 id="data-sources" className="text-lg font-semibold">
          Data sources
        </h2>
        <div className="mt-4 flex flex-col gap-3">
          <a href={TMDB_URL} rel="noopener noreferrer" className="w-fit">
            <Image
              src={TMDB_LOGO.src}
              alt={TMDB_LOGO.alt}
              width={Math.round(TMDB_LOGO.width / 2)}
              height={Math.round(TMDB_LOGO.height / 2)}
              unoptimized
            />
          </a>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Movie and series information from{" "}
            <a href={TMDB_URL} rel="noopener noreferrer" className="underline">
              The Movie Database (TMDB)
            </a>
            . {TMDB_NOTICE}
          </p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {JUSTWATCH_ATTRIBUTION} Availability is shown for the United States
            and may change; CineMatch links to provider information, not
            directly to playback.
          </p>
        </div>
      </section>

      <p className="mt-10">
        <Link href="/" className="underline">
          Back to CineMatch
        </Link>
      </p>
    </main>
  );
}
