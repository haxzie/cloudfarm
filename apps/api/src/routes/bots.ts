import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { bot } from "../db/schema";
import { requireAuth, sessionMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const createBotSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280).default(""),
  charter: z.string().trim().max(4000).default(""),
  avatarShape: z.string().trim().min(1).max(40),
  avatarColor: z.string().trim().min(1).max(40),
});

const updateBotSchema = createBotSchema.partial();

export const bots = new Hono<AppEnv>()
  .use(sessionMiddleware, requireAuth)

  .get("/", async (c) => {
    const rows = await c.var.db
      .select()
      .from(bot)
      .where(and(eq(bot.userId, c.var.user!.id), isNull(bot.archivedAt)))
      .orderBy(desc(bot.lastMessageAt), desc(bot.createdAt));

    return c.json({ bots: rows });
  })

  .post("/", zValidator("json", createBotSchema), async (c) => {
    const input = c.req.valid("json");
    const [created] = await c.var.db
      .insert(bot)
      .values({ id: crypto.randomUUID(), userId: c.var.user!.id, ...input })
      .returning();

    return c.json({ bot: created }, 201);
  })

  .patch("/:id", zValidator("json", updateBotSchema), async (c) => {
    const id = c.req.param("id");
    await assertOwned(c.var.db, id, c.var.user!.id);

    const [updated] = await c.var.db
      .update(bot)
      .set(c.req.valid("json"))
      .where(eq(bot.id, id))
      .returning();

    // The agent caches its profile, so tell it to re-read the row.
    const stub = await getAgentStub(c.env, id);
    await stub.refreshProfile();

    return c.json({ bot: updated });
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await assertOwned(c.var.db, id, c.var.user!.id);

    await c.var.db.update(bot).set({ archivedAt: new Date() }).where(eq(bot.id, id));
    return c.body(null, 204);
  });

async function assertOwned(db: AppEnv["Variables"]["db"], botId: string, userId: string) {
  const [row] = await db
    .select({ userId: bot.userId })
    .from(bot)
    .where(eq(bot.id, botId))
    .limit(1);

  if (!row || row.userId !== userId) {
    throw new HTTPException(404, { message: "Bot not found" });
  }
}

async function getAgentStub(env: Env, botId: string) {
  const { getAgentByName } = await import("agents");
  const { botAgents } = await import("../agents/namespaces");
  return getAgentByName(botAgents(env), botId);
}

export { assertOwned };
