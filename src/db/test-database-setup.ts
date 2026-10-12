import path from "node:path";
import { resolveTestDatabaseUrl } from "./test-database-safety";

// Vitest runs setup files before importing each DB suite, so no suite can open
// a connection or execute destructive fixtures before this read-only check.
resolveTestDatabaseUrl({ cwd: path.resolve(__dirname, "../..") });
