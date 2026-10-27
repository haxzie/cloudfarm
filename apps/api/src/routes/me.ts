import { Hono } from "hono";

import { requireAuth, sessionMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const me = new Hono<AppEnv>()
  .use(sessionMiddleware)
  .get("/", requireAuth, (c) =>
    c.json({
      user: c.var.user,
      session: c.var.session,
    }),
  );
