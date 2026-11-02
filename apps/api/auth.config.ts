/**
 * Entry point for the Better Auth CLI (`pnpm auth:generate`), which only reads
 * the config to derive the database schema and never opens a connection.
 * The Worker builds its own instance per request — see src/lib/auth.ts.
 */
import { createDb } from "./src/db";
import { createAuth } from "./src/lib/auth";

// Through `unknown` because `Env` now carries bindings — Durable Objects, R2,
// Browser Run — that the CLI has no way to supply and never touches.
export const auth = createAuth(createDb(null as unknown as D1Database), {
  BETTER_AUTH_SECRET: "cli-placeholder",
  BETTER_AUTH_URL: "http://localhost:8797",
  WEB_URL: "http://localhost:3101",
} as unknown as Env);
