export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-6xl dark:text-zinc-50">
        CineMatch
      </h1>
      <p className="mt-4 max-w-sm text-base text-zinc-600 sm:text-lg dark:text-zinc-400">
        Find something to watch in under two minutes.
      </p>
    </div>
  );
}
