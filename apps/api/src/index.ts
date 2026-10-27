import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { bots } from "./routes/bots";
import { favicon } from "./routes/favicon";
import { me } from "./routes/me";
import { createDb } from "./db";
import { bot } from "./db/schema";
import { eq } from "drizzle-orm";
import { createAuth } from "./lib/auth";
import { withAuth } from "./middleware/auth";
import type { AppEnv } from "./types";

export { BotAgent } from "./agents/bot-agent";
export { WorkspaceAgent } from "./agents/workspace-agent";
export { BotSandbox } from "./agents/bot-sandbox";
// S3Mount routes the sandbox's storage requests here, where they get signed.
export { S3Gateway } from "@cloudflare/sandbox";
// The browser tools run the model's code in a Dynamic Worker through this.
export { CodemodeRuntime } from "@cloudflare/codemode";

const app = new Hono<AppEnv>();

app.use(logger());

// The web app runs on a different origin, so auth cookies need credentialed CORS.
app.use(
  "/api/*",
  cors({
    origin: (_origin, c) => c.env.WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.use("/api/*", withAuth);

// Better Auth owns every method under its basePath.
app.all("/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

app.route("/api/me", me);
app.route("/api/bots", bots);
app.route("/api/favicon", favicon);

app.get("/", (c) => c.json({ name: "cloudfarm-api", ok: true }));

/**
 * Agent connections are WebSockets, so they can't carry a CORS preflight or an
 * Authorization header — the session cookie is the only credential. Ownership is
 * checked here rather than inside the Durable Object, which has no session.
 */
app.all("/agents/*", async (c) => {
  const auth = createAuth(createDb(c.env.DB), c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const [, , agentKind, instance] = new URL(c.req.url).pathname.split("/");
  if (!instance) {
    throw new HTTPException(404, { message: "Unknown agent" });
  }

  if (agentKind === "workspace-agent") {
    // One workspace per user, addressed by user id.
    if (instance !== session.user.id) {
      throw new HTTPException(404, { message: "Unknown workspace" });
    }
  } else if (agentKind === "bot-agent") {
    const db = createDb(c.env.DB);
    const [row] = await db
      .select({ userId: bot.userId })
      .from(bot)
      .where(eq(bot.id, instance))
      .limit(1);

    if (!row || row.userId !== session.user.id) {
      throw new HTTPException(404, { message: "Bot not found" });
    }
  } else {
    throw new HTTPException(404, { message: "Unknown agent" });
  }

  const response = await routeAgentRequest(c.req.raw, c.env);
  if (!response) {
    throw new HTTPException(404, { message: "Unknown agent" });
  }
  return response;
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
