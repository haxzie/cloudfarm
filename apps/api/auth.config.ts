/**
 * Entry point for the Better Auth CLI (`pnpm auth:generate`), which only reads
 * the config to derive the database schema and never opens a connection.
 * The Worker builds its own instance per request — see src/lib/auth.ts.
 */
import { createDb } from "./src/db";
import { createAuth } from "./src/lib/auth";

export const auth = createAuth(createDb(null as unknown as D1Database), {
  BETTER_AUTH_SECRET: "cli-placeholder",
  BETTER_AUTH_URL: "http://localhost:8787",
  WEB_URL: "http://localhost:3000",
} as Env);
