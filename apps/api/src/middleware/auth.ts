import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { createDb } from "../db";
import { createAuth } from "../lib/auth";
import type { AppEnv } from "../types";

/** Builds the per-request Drizzle client and Better Auth instance. */
export const withAuth = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  c.set("db", db);
  c.set("auth", createAuth(db, c.env));
  await next();
});

/** Resolves the current session, if any, onto the context. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", result?.user ?? null);
  c.set("session", result?.session ?? null);
  await next();
});

/** Rejects the request when there is no session. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  await next();
});
