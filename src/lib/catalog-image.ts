/** Official TMDB image construction: https://developer.themoviedb.org/docs/image-basics */
export function catalogPosterUrl(path: string | null): string | null {
  if (!path) return null;
  let filename = path;
  if (path.startsWith("https://")) {
    try {
      const url = new URL(path);
      if (
        url.origin !== "https://image.tmdb.org" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return null;
      const match =
        /^\/t\/p\/(?:w[0-9]+|original)(\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp))$/.exec(
          url.pathname,
        );
      if (!match) return null;
      filename = match[1]!;
    } catch {
      return null;
    }
  }
  if (!/^\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(filename)) return null;
  return `https://image.tmdb.org/t/p/w500${filename}`;
}
