import {
  resolveDatabaseUrl,
  type ResolveDatabaseUrlOptions,
} from "./database-url";

const SAFETY_ERROR =
  "Refusing to run database integration tests: DATABASE_URL must target a " +
  "disposable local Postgres database using postgres:// or postgresql:// " +
  "with localhost, 127.0.0.1 or [::1], and no query parameters or fragment. " +
  "Never use the live catalog or a remote database (including Neon). " +
  "See the local Docker configuration in .env.example.";

// Check the original authority, not only URL.hostname: URL parsing can normalize
// noncanonical addresses, and database drivers can interpret encoded hosts or
// multiple hosts differently. Query parameters could also override routing.
const LOCAL_DATABASE_URL =
  /^postgres(?:ql)?:\/\/(?:[^@/?#\\\s]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^?#\\\s]*)?$/;

/** Reject unsafe or ambiguous targets without connecting or exposing credentials. */
export function assertLocalTestDatabaseUrl(databaseUrl: string): void {
  try {
    if (
      !LOCAL_DATABASE_URL.test(databaseUrl) ||
      [...databaseUrl].some(
        (character) =>
          character.charCodeAt(0) < 0x21 || character.charCodeAt(0) === 0x7f,
      )
    ) {
      throw new Error();
    }

    const parsed = new URL(databaseUrl);
    if (parsed.port === "0") throw new Error();
    // Postgres.js decodes credentials; reject malformed escapes here as well.
    decodeURIComponent(databaseUrl);
  } catch {
    // URL and URI parser errors can include the supplied connection string.
    throw new Error(SAFETY_ERROR);
  }
}

/** Use exactly the same environment/.env.local precedence as the DB suites. */
export function resolveTestDatabaseUrl(
  options: ResolveDatabaseUrlOptions = {},
): string {
  const databaseUrl = resolveDatabaseUrl(options);
  assertLocalTestDatabaseUrl(databaseUrl);
  return databaseUrl;
}
