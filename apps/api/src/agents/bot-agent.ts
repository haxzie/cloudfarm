import { createAnthropic } from "@ai-sdk/anthropic";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { Agent, callable } from "agents";
import { connectBrowserSession, listBrowserTargets } from "agents/browser";
import { createBrowserRuntime } from "agents/browser/ai";
import {
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type JSONSchema7,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { eq } from "drizzle-orm";

import { createDb } from "../db";
import { bot } from "../db/schema";
import { workspaceAgents } from "./namespaces";
import type { ConnectorTool } from "./workspace-agent";
import { createFileTools, listBotFiles, readBotFile, type BotFile } from "./tools/files";
import { createMemoryTools, readMemoryContext } from "./tools/memory";
import { createShellTools } from "./tools/shell";

export type BotProfile = {
  id: string;
  userId: string;
  name: string;
  description: string;
  charter: string;
  model: string;
};

export type StoredMessage = {
  id: string;
  author: "user" | "bot";
  body: string;
  sentAt: number;
};

export type BrowserAction = {
  id: string;
  at: number;
  tool: string;
  summary: string;
  ok: boolean;
  /** Why it failed. Only set when `ok` is false. */
  error?: string;
};

type BotAgentState = {
  profile: BotProfile | null;
  /** Lets the UI show a thinking indicator without streaming tokens. */
  status: "idle" | "thinking";
  /** Set when the last turn failed, so the UI can show it in context. */
  lastError: string | null;
  /**
   * The window the UI renders. SQLite below holds the full thread; this is
   * synced to connected clients automatically, so there is nothing to fetch.
   */
  messages: StoredMessage[];
  /** What the bot has done in its browser, newest last. */
  browserLog: BrowserAction[];
};

const BASE_SYSTEM = `You are a bot inside cloudfarm, a workspace where each bot is
a persistent teammate with its own conversation.

Be direct and concise. Prefer finishing the task over narrating it. When you need
something from the user to proceed, ask one specific question rather than listing
possibilities.

You have your own computer:
- A durable folder at /workspace. Use the file tools for reading and writing
  text; use the shell for anything that needs a program.
- A Linux sandbox reached with exec. It starts on first use and sleeps when
  idle, so prefer one considered command over many small ones.
- A browser for pages that need rendering or interaction. For a plain API or a
  static page, curl in the shell is faster and cheaper.

Do the work with the tools rather than describing what you would do. Never claim
a file was written or a page was read unless the tool confirmed it.`;

/**
 * How the bot is told to use its memory files. Separate from BASE_SYSTEM only
 * for legibility — both are always sent. See tools/memory.ts for the layers.
 */
const MEMORY_SYSTEM = `Keep notes on your own work. You will not remember this
conversation forever: older messages fall out of your context, and anything you
did not write down is gone.

- The moment you learn something, call remember. A finding, a conclusion, a fact
  about your owner or their systems, a decision and why you made it, a mistake
  you should not repeat. Write it as you go, not at the end of the task.
- Be concrete. "The staging API rejects requests without an X-Env header" is
  worth keeping; "looked into the API" is not.
- MEMORY.md is your curated long-term memory: durable facts and standing
  decisions that should be true at the start of every turn. Read it before you
  change it, edit it in place with write_file, and keep it short — it is
  reloaded every turn. Detail belongs in the daily notes.
- NOTES.md is how you work: conventions you have settled on, lessons learned.
  Update it when you get something wrong.
- Before saying you do not know something, and before redoing work you may have
  done on an earlier day, use search_memory.
- Leave secrets and credentials out of your notes unless your owner asked you to
  keep them.`;

/**
 * The silent turn that runs before old messages fall out of the context window.
 * Without it the thread is simply truncated and whatever was learned in it is
 * lost — this is the bot's last chance to write it down. Modelled on OpenClaw's
 * pre-compaction memory flush.
 */
const FLUSH_SYSTEM = `You are writing to your own memory files. This is
housekeeping: the owner will not see your reply, so do not address them.`;

const FLUSH_PROMPT = `The earliest part of this conversation is about to fall out
of your context window. Write down anything from it that should survive.

Append new findings and conclusions to today's note with remember, and update
MEMORY.md if a durable fact or standing decision changed. Only new material —
do not replay notes you have already written.

If there is nothing worth keeping, write nothing and reply with NO_REPLY.`;

const COMPACT_SYSTEM = `You are compacting a conversation so it can continue past
the model's context window. Reply with the summary and nothing else — no
preamble, no commentary, no offer to help.`;

/**
 * What the summary has to carry. The headings are what a later turn actually
 * needs to pick the thread back up; the identifier rule is OpenClaw's
 * `identifierPolicy: "strict"`, and it matters — a summary that paraphrases an
 * API key, a file path or an account id has destroyed it.
 */
const COMPACT_INSTRUCTIONS = `Summarize the conversation below so a future turn
can continue it without reading the original messages.

Use these headings, dropping any that would be empty:

## Context — what the owner is working on, and why.
## Decisions — what was settled, and the reasoning behind it.
## Facts — what was established. Names, URLs, ids, file paths, numbers.
   Copy identifiers exactly, character for character; never paraphrase,
   shorten or tidy one.
## Work done — what you actually did and what came back.
## Open — what is unfinished, what the owner is waiting on, and any question
   you asked that has not been answered.

Be specific. "Discussed the API" is worthless; "the staging API rejects
requests without an X-Env header" is the point. Invent nothing that is not in
the text, and do not guess at content marked as trimmed.`;
/**
 * One shared Browser Run session per bot, so a login or a half-finished form
 * survives between tool calls — and so Live View has something to show. The
 * tools and the connector below must agree on this.
 */
const BROWSER_SESSION = {
  mode: "reuse",
  key: "main",
  // Browser Run closes an idle session after about a minute, which is shorter
  // than the gap between two messages. Browser Run caps this server-side.
  keepAliveMs: 10 * 60_000,
} as const;

/** How many past messages to send to the model. */
const HISTORY_LIMIT = 40;

/**
 * Tool-calling steps allowed in one turn before the model must answer. Set
 * high so a long task finishes in one turn instead of stopping half-done; a
 * turn that needs this many steps is rare, and the ceiling only binds runaways.
 */
const MAX_STEPS = 60;

/** How many messages to keep in synced state for the UI. */
const VIEW_LIMIT = 100;

/** How many browser actions to keep in synced state. */
const BROWSER_LOG_LIMIT = 50;

/**
 * How long one screenshot attempt may take. A composited tab answers in well
 * under 100ms; anything near this is a tab that needs raising first.
 */
const SCREENSHOT_TIMEOUT_MS = 4_000;

/**
 * Messages a thread may grow by before the memory flush runs again. Well under
 * HISTORY_LIMIT so the flush still sees the messages it is saving.
 */
const FLUSH_EVERY = 24;

/** Where the flush watermark lives. Not in agent state: the UI has no use for it. */
const FLUSH_MARK_KEY = "memoryFlushedAtCount";

/** Tool steps the flush may take. It only writes a note or two. */
const FLUSH_MAX_STEPS = 8;

/**
 * Messages allowed past the last compaction boundary before the older ones are
 * summarized. Below HISTORY_LIMIT, so compaction always fires before the
 * backstop slice would drop anything.
 */
const COMPACT_AFTER = 32;

/**
 * Messages kept verbatim at the end of the window. Everything older becomes
 * the summary. A tail this size covers the current topic, which is the part a
 * summary is worst at preserving.
 */
const KEEP_RECENT = 16;

/**
 * Characters past the boundary before compacting, whatever the message count.
 * A message count alone is the wrong trigger: what fills a context window is
 * text, and a handful of long tool-heavy replies can be larger than fifty
 * short ones. Roughly 40k tokens of conversation.
 */
const COMPACT_AFTER_CHARS = 160_000;

/** Per-message and total ceilings on what the summarizer is asked to read. */
const COMPACT_MESSAGE_CHARS = 2_000;
const COMPACT_INPUT_CHARS = 120_000;

/**
 * Messages to wait before retrying a compaction that failed, so a persistently
 * failing summarizer costs one request every few turns rather than every turn.
 */
const COMPACT_RETRY_GAP = 8;
const COMPACT_RETRY_KEY = "compactRetryAfterCount";

/**
 * One instance per bot, addressed by the bot's id. Owns the conversation and the
 * working state; the D1 row is only its configuration.
 *
 * Replies are generated in full and then persisted — the client is notified that
 * the thread changed rather than being streamed tokens. The model call itself
 * still streams, so a long reply can't trip an HTTP timeout.
 */
export class BotAgent extends Agent<Env, BotAgentState> {
  initialState: BotAgentState = {
    profile: null,
    status: "idle",
    lastError: null,
    messages: [],
    browserLog: [],
  };

  private schemaReady = false;
  /**
   * The tab the workbench is showing. Without this the capture picks "the last
   * page in the listing" every time, and that changes as the bot opens tabs or
   * a page briefly reports `about:blank` mid-navigation — so the preview jumps.
   */
  private previewTargetId: string | null = null;

  /**
   * A turn only ever ends by setting `status` back to "idle". If the instance
   * dies in the middle of one — evicted, redeployed, or the Worker reloading
   * in development — that never runs, and the persisted "thinking" leaves the
   * composer disabled with no way for the owner to send anything again.
   *
   * An instance that is only now starting cannot have a turn in flight, so a
   * "thinking" status here is always stale.
   */
  override onStart(): void {
    if (this.state?.status !== "thinking") return;

    this.setState({
      ...this.state,
      status: "idle",
      lastError: "That turn was interrupted before it finished. Send the message again.",
    });
  }

  private ensureSchema() {
    if (this.schemaReady) return;
    this.sql`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        sent_at INTEGER NOT NULL
      )
    `;
    // One row per compaction. `through_id` is the last message the summary
    // covers; everything after it is still sent verbatim. Keyed by message id
    // rather than timestamp because two messages can share a millisecond.
    this.sql`
      CREATE TABLE IF NOT EXISTS compaction (
        id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        through_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
    this.schemaReady = true;
  }

  // --- reads -------------------------------------------------------------

  private readMessages(): StoredMessage[] {
    this.ensureSchema();
    const rows = this.sql<{
      id: string;
      author: "user" | "bot";
      body: string;
      sent_at: number;
    }>`SELECT id, author, body, sent_at FROM message ORDER BY sent_at ASC, rowid ASC`;

    return rows.map((row) => ({
      id: row.id,
      author: row.author,
      body: row.body,
      sentAt: row.sent_at,
    }));
  }

  // --- writes ------------------------------------------------------------

  /** Appends a user message and generates the reply. */
  @callable()
  async sendMessage(body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;

    this.appendMessage("user", trimmed);
    // The action log covers this turn only: last turn's steps are about a page
    // the bot has moved on from, and keeping them makes the list unreadable.
    this.setState({ ...this.state, status: "thinking", lastError: null, browserLog: [] });

    try {
      const reply = await this.generateReply();
      this.appendMessage("bot", reply);
      this.setState({ ...this.state, status: "idle" });
      // After the reply is on screen: the owner is not waiting on this.
      await this.maintain();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      console.error("bot turn failed", error);
      this.setState({ ...this.state, status: "idle", lastError: message });
    }
  }

  /** Clears the thread. */
  @callable()
  async clearMessages(): Promise<void> {
    this.ensureSchema();
    this.sql`DELETE FROM message`;
    this.sql`DELETE FROM compaction`;
    this.syncMessages();
    await this.projectPreview(null);
  }

  // ── Workbench ───────────────────────────────────────────────────────
  // The panel beside the chat drives the same workspace the tools use.

  /** Every file in the bot's folder, for the file tree. */
  @callable()
  async listWorkspace(): Promise<BotFile[]> {
    return (await listBotFiles(this.env.ASSETS, this.name)) ?? [];
  }

  /** One file's text, for the preview pane. */
  @callable()
  async readWorkspaceFile(path: string) {
    return readBotFile(this.env.ASSETS, this.name, path);
  }

  /**
   * A screenshot of what the bot's browser is showing.
   *
   * Live View is an interactive handover surface, and under local dev it is
   * the raw DevTools frontend. This is the plain answer to "what is on the
   * page": capture the tab over CDP and hand back an image, which looks the
   * same in development and in production.
   */
  @callable()
  async browserScreenshot(
    targetId?: string,
  ): Promise<
    | { targetId: string; pageUrl?: string; title?: string; image: string }
    | { empty: true }
    | { error: string }
  > {
    const session = await this.browserConnector().sessionInfo();
    if (!session) return { empty: true };

    let connection: Awaited<ReturnType<typeof connectBrowserSession>> | undefined;
    try {
      const targets = await listBrowserTargets(this.env.BROWSER, session.sessionId);
      const pages = targets.filter((candidate) => (candidate.type ?? "page") === "page");
      // Prefer a tab that is actually showing something over a blank one.
      const real = pages.filter((candidate) => candidate.url && candidate.url !== "about:blank");

      // An explicit choice wins, then whatever was shown last, then the newest
      // non-blank tab. Sticking to one tab is what keeps the preview steady.
      const target =
        pages.find((candidate) => candidate.id === targetId) ??
        pages.find((candidate) => candidate.id === this.previewTargetId) ??
        real.at(-1) ??
        pages.at(-1);
      if (!target) return { empty: true };

      this.previewTargetId = target.id;

      connection = await connectBrowserSession(this.env.BROWSER, session.sessionId);
      const cdpSession = await connection.attachToTarget(target.id);
      await connection.send("Page.enable", {}, { sessionId: cdpSession });

      /*
       * Captured from the compositor surface — the default, and the only mode
       * that returns real pixels here. `fromSurface: false` never times out,
       * which is why it looked like the safe choice, but it hands back the
       * same blank frame every time (measured against the dev browser: a
       * constant 32,100 bytes for any page, versus ~200KB from the surface).
       *
       * That blank frame is specific to the Chrome 126 build Browser Run
       * ships; a current Chrome returns real pixels for `fromSurface: false`,
       * which is why the flag looks harmless in the CDP docs.
       *
       * The catch is that a surface capture needs a tab that has actually
       * painted. A never-navigated `about:blank` hangs until the timeout —
       * measured — so the slow path raises it and retries. Real pages capture
       * on the fast path whether or not they are in front, so raising a tab
       * (which would cost the bot the foreground) stays a last resort.
       */
      const live = connection;
      const capture = (timeoutMs: number) =>
        live.send(
          "Page.captureScreenshot",
          { format: "jpeg", quality: 55 },
          { sessionId: cdpSession, timeoutMs },
        ) as Promise<{ data?: string }>;

      let shot: { data?: string };
      try {
        // Short, because the panel polls every 1.5s — a long wait here just
        // queues up more of them.
        shot = await capture(SCREENSHOT_TIMEOUT_MS);
      } catch {
        await live.send("Page.bringToFront", {}, { sessionId: cdpSession });
        shot = await capture(SCREENSHOT_TIMEOUT_MS);
      }

      if (!shot.data) return { error: "The page returned no image." };

      return {
        targetId: target.id,
        pageUrl: target.url,
        title: target.title,
        image: `data:image/jpeg;base64,${shot.data}`,
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Could not capture the page." };
    } finally {
      // Dropping the socket leaves the Browser Run session itself running.
      connection?.disconnect();
    }
  }

  /** Tabs open in the bot's browser. */
  @callable()
  async browserTargets() {
    const session = await this.browserConnector().sessionInfo();
    if (!session) return [];

    const targets = await listBrowserTargets(this.env.BROWSER, session.sessionId);
    return targets
      .filter((target) => (target.type ?? "page") === "page")
      .map((target) => ({ targetId: target.id, pageUrl: target.url, title: target.title }));
  }

  /**
   * The browser tools and the connector the workbench reads, from one runtime.
   *
   * These have to come from the same place. Built separately — the tools from
   * `createBrowserTools`, the connector from a hand-rolled
   * `DurableBrowserSessionStore` — they own two different sessions, and the
   * panel reports "No session" while the bot is driving a real browser.
   */
  private browserRuntime() {
    return createBrowserRuntime({
      ctx: this.ctx,
      browser: this.env.BROWSER,
      loader: this.env.LOADER,
      session: BROWSER_SESSION,
    });
  }

  /** The session the browser tools are actually using. */
  private browserConnector() {
    return this.browserRuntime().connector;
  }

  /** Called by the API when the bot's configuration changes in D1. */
  @callable()
  async refreshProfile(): Promise<void> {
    this.setState({ ...this.state, profile: null });
    await this.profile();
  }

  // --- internals ---------------------------------------------------------

  private appendMessage(author: "user" | "bot", body: string) {
    this.ensureSchema();
    const row: StoredMessage = {
      id: crypto.randomUUID(),
      author,
      body,
      sentAt: Date.now(),
    };
    this.sql`
      INSERT INTO message (id, author, body, sent_at)
      VALUES (${row.id}, ${row.author}, ${row.body}, ${row.sentAt})
    `;
    this.syncMessages();
    void this.projectPreview(row);
  }

  /** Pushes the rendered window to connected clients. */
  private syncMessages() {
    this.setState({ ...this.state, messages: this.readMessages().slice(-VIEW_LIMIT) });
  }

  /**
   * Housekeeping after a reply has been delivered: write memory down, then
   * summarize what is about to leave the window.
   *
   * Order matters, and it is OpenClaw's: the flush runs against the full
   * history, so the bot sees the real messages rather than a summary of them.
   * Compaction is lossy by definition; the notes it writes first are not.
   */
  private async maintain(): Promise<void> {
    const total = this.readMessages().length;
    const live = this.liveMessages();
    const chars = live.reduce((sum, message) => sum + message.body.length, 0);

    if (live.length >= COMPACT_AFTER || chars >= COMPACT_AFTER_CHARS) {
      await this.flushMemory(total);
      await this.compact();
      return;
    }

    const flushedAt = (await this.ctx.storage.get<number>(FLUSH_MARK_KEY)) ?? 0;
    if (total - flushedAt >= FLUSH_EVERY) await this.flushMemory(total);
  }

  /**
   * Gives the bot a silent turn to write down what it learned, once the thread
   * has grown enough that the oldest messages are about to be dropped from the
   * next prompt. There is no compaction here — history is truncated outright —
   * so this is the only thing standing between a long thread and amnesia.
   *
   * The flush conversation is never persisted, so its housekeeping messages do
   * not show up in the chat or in later turns. Its writes are ordinary files.
   */
  private async flushMemory(count: number): Promise<void> {
    // Marked before the attempt: a flush that fails should not retry on every
    // message for the rest of the thread.
    await this.ctx.storage.put(FLUSH_MARK_KEY, count);

    try {
      const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
      const profile = await this.profile();

      const result = streamText({
        model: anthropic(profile?.model ?? "claude-opus-5-5"),
        system: FLUSH_SYSTEM,
        messages: [...this.history(), { role: "user", content: FLUSH_PROMPT }],
        // Memory only. The flush is not the place to browse or run commands.
        tools: createMemoryTools(this.env.ASSETS, this.name),
        stopWhen: stepCountIs(FLUSH_MAX_STEPS),
      });

      await result.text;
    } catch (cause) {
      // Losing a flush costs some memory; failing the turn would cost the reply.
      console.error("memory flush failed", cause);
    }
  }

  /**
   * Summarizes the older part of the thread into one entry and records where
   * it ends, so later turns send the summary plus a verbatim tail instead of a
   * window that silently drops its oldest messages.
   *
   * Nothing is deleted: every message stays in SQLite and on screen. This only
   * changes what the model is shown.
   */
  private async compact(): Promise<void> {
    const count = this.readMessages().length;
    const retryAfter = (await this.ctx.storage.get<number>(COMPACT_RETRY_KEY)) ?? 0;
    if (count < retryAfter) return;

    const live = this.liveMessages();
    const older = live.slice(0, live.length - KEEP_RECENT);
    const through = older.at(-1);
    if (!through) return;

    try {
      const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
      const profile = await this.profile();
      const previous = this.latestCompaction();

      const result = streamText({
        model: anthropic(profile?.model ?? "claude-opus-5-5"),
        system: COMPACT_SYSTEM,
        messages: [
          { role: "user", content: compactionInput(older, previous?.summary ?? null) },
        ],
      });

      const summary = (await result.text).trim();

      // A summary cut off mid-sentence is worse than no summary: it would be
      // written as the only record of everything before it. Leave the history
      // alone and let the next turn try again.
      if (!summary || (await result.finishReason) === "length") {
        throw new Error("the summary was empty or cut short");
      }

      this.ensureSchema();
      this.sql`
        INSERT INTO compaction (id, summary, through_id, created_at)
        VALUES (${crypto.randomUUID()}, ${summary}, ${through.id}, ${Date.now()})
      `;
      await this.ctx.storage.delete(COMPACT_RETRY_KEY);
    } catch (cause) {
      console.error("compaction failed", cause);
      await this.ctx.storage.put(COMPACT_RETRY_KEY, count + COMPACT_RETRY_GAP);
    }
  }

  /** The newest compaction entry, or null while the thread is still short. */
  private latestCompaction(): { summary: string; throughId: string } | null {
    this.ensureSchema();
    const [row] = this.sql<{ summary: string; through_id: string }>`
      SELECT summary, through_id FROM compaction ORDER BY created_at DESC, rowid DESC LIMIT 1
    `;

    return row ? { summary: row.summary, throughId: row.through_id } : null;
  }

  /** Messages after the last compaction boundary — the part still sent verbatim. */
  private liveMessages(): StoredMessage[] {
    const all = this.readMessages();
    const boundary = this.latestCompaction();
    if (!boundary) return all;

    const index = all.findIndex((message) => message.id === boundary.throughId);
    // A boundary we cannot find means the thread was cleared underneath it.
    return index === -1 ? all : all.slice(index + 1);
  }

  /** The window of the thread sent to the model, newest-first truncation aside. */
  private history(): ModelMessage[] {
    return this.liveMessages()
      // A backstop only: compaction fires first, so this should never bite.
      .slice(-HISTORY_LIMIT)
      .map((message) => ({
        role: message.author === "user" ? "user" : "assistant",
        content: message.body,
      }));
  }

  private async generateReply(): Promise<string> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — add it to apps/api/.dev.vars (or as a Worker secret) and restart.",
      );
    }

    const profile = await this.profile();
    const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    // Streamed from the model so a long reply can't hit a request timeout, then
    // awaited in full — nothing is streamed onward to the client.
    const result = streamText({
      // `thinking` is deliberately unset: omitting it on Claude Opus 5.5 runs
      // adaptive thinking, which is what we want for open-ended work.
      model: anthropic(profile?.model ?? "claude-opus-5-5"),
      system: await this.systemPrompt(profile),
      messages: this.history(),
      tools: await this.tools(),
      stopWhen: stepCountIs(MAX_STEPS),
    });

    const text = (await result.text).trim();
    return text || "(no response)";
  }

  /** The bot's computer: files in R2, a shell in its sandbox, and a browser. */
  private async tools(): Promise<ToolSet> {
    return {
      ...(await this.connectorTools()),
      ...createMemoryTools(this.env.ASSETS, this.name),
      ...createFileTools(this.env.ASSETS, this.name),
      ...createShellTools(this.ctx.exports.BotSandbox, this.name),
      ...this.withBrowserLog(this.browserRuntime().tools),
    };
  }

  /**
   * Tools from the account's connected MCP servers, behind one Code Mode tool.
   *
   * The connections live on the user's WorkspaceAgent — one sign-in per
   * account, shared by every bot — so the definitions are fetched from it each
   * turn and calls are proxied back to it. Names are namespaced per server so
   * two servers offering `search` do not collide.
   *
   * They are not spread into the turn individually: a handful of servers is
   * dozens of schemas re-sent on every step, which crowds the prompt and makes
   * the model's choice worse. Code Mode gives it one `apps` tool instead and
   * lets it write JavaScript that calls them — so chaining three calls is one
   * step rather than three.
   */
  private async connectorTools(): Promise<ToolSet> {
    const profile = await this.profile();
    if (!profile) return {};

    const hub = workspaceAgents(this.env).getByName(profile.userId);

    let available: ConnectorTool[];
    try {
      available = JSON.parse(await hub.mcpToolsJson()) as ConnectorTool[];
    } catch (cause) {
      // A connector problem should not take the whole turn down.
      console.error("could not load connector tools", cause);
      return {};
    }

    const tools: ToolSet = {};

    for (const definition of available) {
      tools[toolName(definition.serverId, definition.name)] = tool({
        description: definition.description,
        // The schema comes from the server at runtime, so the input type is
        // only known as "some record".
        inputSchema: jsonSchema<Record<string, unknown>>(
          definition.inputSchema as JSONSchema7,
        ),
        execute: async (args) =>
          JSON.parse(
            await hub.callMcpToolJson(
              definition.serverId,
              definition.name,
              JSON.stringify(args),
            ),
          ) as unknown,
      });
    }

    if (Object.keys(tools).length === 0) return {};

    return {
      apps: createCodeTool({
        tools: [{ name: "apps", tools }],
        executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
      }),
    };
  }

  /**
   * Records every browser tool call so the workbench can show what the bot did
   * in the browser, next to the page it did it on.
   */
  private withBrowserLog(tools: ToolSet): ToolSet {
    const wrapped: ToolSet = {};

    for (const [name, tool] of Object.entries(tools)) {
      if (!tool.execute) {
        wrapped[name] = tool;
        continue;
      }

      const run = tool.execute.bind(tool);
      wrapped[name] = {
        ...tool,
        execute: async (input, options) => {
          try {
            const result = await run(input, options);
            this.recordBrowserAction(name, input, true);
            return result;
          } catch (cause) {
            // Keep the reason: "the browser tool went red" is not something
            // anyone can act on, and this is the only place it surfaces.
            this.recordBrowserAction(
              name,
              input,
              false,
              cause instanceof Error ? cause.message : String(cause),
            );
            throw cause;
          }
        },
      };
    }

    return wrapped;
  }

  private recordBrowserAction(tool: string, input: unknown, ok: boolean, error?: string) {
    const action: BrowserAction = {
      id: crypto.randomUUID(),
      at: Date.now(),
      tool,
      summary: summarizeToolInput(input),
      ok,
      ...(error ? { error: error.slice(0, 300) } : {}),
    };

    // `initialState` only applies to a fresh instance, so a bot created before
    // this field existed has no `browserLog` in its stored state.
    const current = this.state.browserLog ?? [];

    this.setState({
      ...this.state,
      browserLog: [...current, action].slice(-BROWSER_LOG_LIMIT),
    });
  }

  private async profile(): Promise<BotProfile | null> {
    // A profile cached before `userId` existed is stale — `initialState` does
    // not backfill a running instance, so check the shape, not just presence.
    if (this.state.profile?.userId) return this.state.profile;

    const db = createDb(this.env.DB);
    const [row] = await db
      .select({
        id: bot.id,
        userId: bot.userId,
        name: bot.name,
        description: bot.description,
        charter: bot.charter,
        model: bot.model,
      })
      .from(bot)
      .where(eq(bot.id, this.name))
      .limit(1);

    if (!row) return null;
    this.setState({ ...this.state, profile: row });
    return row;
  }

  /**
   * Built fresh each turn, so a note the bot wrote during the last turn is in
   * front of it on this one.
   */
  private async systemPrompt(profile: BotProfile | null) {
    const memory = await readMemoryContext(this.env.ASSETS, this.name);
    // Earlier turns, summarized. It rides in the system prompt rather than as a
    // fake message so the model never mistakes it for something the owner said.
    const earlier = this.latestCompaction()?.summary;

    return [
      BASE_SYSTEM,
      "",
      MEMORY_SYSTEM,
      profile && "",
      profile && `Your name is ${profile.name}.`,
      profile?.description && `Your job: ${profile.description}`,
      profile?.charter && `Operating notes from your owner:\n${profile.charter}`,
      earlier &&
        `\n# Earlier in this conversation\n\nA summary of the messages before the ones below, which are no longer shown in full. Treat it as fact, not as something to repeat back.\n\n${earlier}`,
      memory && `\n${memory}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Keeps the sidebar preview in D1 in step with the conversation. */
  private async projectPreview(message: StoredMessage | null) {
    const db = createDb(this.env.DB);
    await db
      .update(bot)
      .set({
        lastMessagePreview: message ? message.body.slice(0, 200) : null,
        lastMessageAuthor: message?.author ?? null,
        lastMessageAt: message ? new Date(message.sentAt) : null,
      })
      .where(eq(bot.id, this.name));
  }
}

/**
 * The summarizer's input: the previous summary, then the messages being folded
 * into it.
 *
 * Two ceilings, because a thread of long replies can be far larger than a
 * request should be. Each message is trimmed, then the oldest are dropped
 * whole if the total is still too big — and the gap is marked so the model
 * knows something is missing rather than inferring a jump in the conversation.
 * OpenClaw allocates its budget across the history more cleverly; this is the
 * same idea at a size where the simple version is enough.
 */
function compactionInput(messages: StoredMessage[], previous: string | null): string {
  const rendered: string[] = [];
  let spent = 0;
  let dropped = 0;

  // Newest first while filling, so the budget goes to the most recent context.
  for (const message of [...messages].reverse()) {
    const who = message.author === "user" ? "Owner" : "You";
    const body =
      message.body.length > COMPACT_MESSAGE_CHARS
        ? `${message.body.slice(0, COMPACT_MESSAGE_CHARS)}… [trimmed]`
        : message.body;
    const line = `${who}: ${body}`;

    if (spent + line.length > COMPACT_INPUT_CHARS) {
      dropped += 1;
      continue;
    }

    spent += line.length;
    rendered.unshift(line);
  }

  if (dropped > 0) {
    rendered.unshift(`[${dropped} older messages omitted — do not guess their contents]`);
  }

  const carry = previous
    ? `This continues an earlier summary. Carry forward everything in it that is still true — it is the only remaining record of what came before.\n\n--- earlier summary ---\n${previous}\n`
    : "";

  return `${COMPACT_INSTRUCTIONS}\n\n${carry}\n--- conversation ---\n${rendered.join("\n\n")}`;
}

/** A short, human-readable version of a browser tool's input. */
function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";

  const record = input as Record<string, unknown>;
  const url = record.url ?? record.href;
  if (typeof url === "string") return url;

  const code = record.code ?? record.script ?? record.query ?? record.prompt;
  if (typeof code === "string") {
    const oneLine = code.replace(/\s+/g, " ").trim();
    return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
  }

  return "";
}

/** `serverId` + tool name, trimmed to what the model APIs accept. */
function toolName(serverId: string, name: string) {
  const safe = `${serverId}_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.length > 64 ? safe.slice(0, 64) : safe;
}
