import { tool } from "ai";
import { z } from "zod";

import { botPrefix } from "./files";

/**
 * The bot's memory, modelled on OpenClaw: plain Markdown in the bot's own
 * workspace rather than a hidden store. Three layers, each with a different
 * lifetime:
 *
 * - `memory/YYYY-MM-DD.md` — the working layer. Append-only findings, raw
 *   observations, what was tried. Today's and yesterday's notes load with the
 *   prompt; older days are reachable with `search_memory`.
 * - `MEMORY.md` — the durable layer. Curated facts, decisions and conclusions
 *   that should be true at the start of every turn. Loaded every turn, so it
 *   has to stay short.
 * - `NOTES.md` — the operating layer. How this bot works: conventions it has
 *   settled on, mistakes it should not repeat. Also loaded every turn.
 *
 * Keeping them as ordinary files means the owner can read and edit the bot's
 * memory in the Files tab, and the bot's own file tools already work on them.
 */

export const NOTES_FILE = "NOTES.md";
export const MEMORY_FILE = "MEMORY.md";
export const DAILY_DIR = "memory/";

/**
 * Per-file and total ceilings on what memory may spend of the prompt. Smaller
 * than OpenClaw's 20k/60k: a bot here answers chat turns rather than running a
 * whole workstation, and an over-long MEMORY.md is a sign to distill it.
 */
const FILE_MAX_CHARS = 8_000;
const TOTAL_MAX_CHARS = 20_000;

/** How many memory files one search will open. */
const SEARCH_FILE_LIMIT = 60;

/**
 * Dates are UTC everywhere — the bot has no reliable sense of the owner's
 * timezone, and a stable key matters more than a local one.
 */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dailyPath(date: Date): string {
  return `${DAILY_DIR}${dayKey(date)}.md`;
}

function key(botId: string, path: string): string {
  return `${botPrefix(botId)}${path}`;
}

async function readText(bucket: R2Bucket, botId: string, path: string): Promise<string | null> {
  const object = await bucket.get(key(botId, path));
  return object ? object.text() : null;
}

async function writeText(bucket: R2Bucket, botId: string, path: string, body: string) {
  await bucket.put(key(botId, path), body, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
}

function clamp(body: string): { text: string; truncated: boolean } {
  if (body.length <= FILE_MAX_CHARS) return { text: body, truncated: false };
  return { text: body.slice(0, FILE_MAX_CHARS), truncated: true };
}

/**
 * The memory section of the system prompt: the curated files in full, plus the
 * last two days of notes. Everything older stays on disk and is found with
 * `search_memory`, so the prompt does not grow with the bot's age.
 *
 * Returns null when the bot has never written anything, so a new bot does not
 * carry a block of empty headings.
 */
export async function readMemoryContext(
  bucket: R2Bucket,
  botId: string,
  now = new Date(),
): Promise<string | null> {
  const yesterday = new Date(now.getTime() - 86_400_000);

  const wanted = [
    { path: NOTES_FILE, label: NOTES_FILE },
    { path: MEMORY_FILE, label: MEMORY_FILE },
    { path: dailyPath(now), label: `${dailyPath(now)} (today)` },
    { path: dailyPath(yesterday), label: `${dailyPath(yesterday)} (yesterday)` },
  ];

  const loaded = await Promise.all(
    wanted.map(async (file) => ({ ...file, body: await readText(bucket, botId, file.path) })),
  );

  const present = loaded.filter((file) => file.body?.trim());
  if (present.length === 0) return null;

  const parts: string[] = [];
  let spent = 0;
  let truncatedAny = false;

  for (const file of present) {
    const { text, truncated } = clamp(file.body!.trim());
    // Stop cleanly at the total budget rather than half-including a file.
    if (spent + text.length > TOTAL_MAX_CHARS) {
      truncatedAny = true;
      break;
    }

    spent += text.length;
    truncatedAny ||= truncated;
    parts.push(`## ${file.label}\n\n${text}`);
  }

  if (truncatedAny) {
    parts.push(
      "_Some memory files were shortened to fit. They are intact on disk — use read_file or search_memory for the rest, and consider distilling them._",
    );
  }

  return `# Your memory\n\nYour own notes, loaded fresh at the start of this turn. Today is ${dayKey(now)} (UTC).\n\n${parts.join("\n\n")}`;
}

/**
 * Tools for writing and finding memory. Reading and rewriting the curated
 * files goes through the ordinary file tools — they are just files — so the
 * only things that need their own tool are the append and the search.
 */
export function createMemoryTools(bucket: R2Bucket, botId: string) {
  return {
    remember: tool({
      description: [
        "Append to today's memory note. Use this the moment you learn something worth",
        "keeping: a finding, a conclusion, a fact about the owner or their systems, a",
        "decision and why, or a mistake to avoid repeating. Append-only and private to",
        "you — write it as you go rather than at the end of the task.",
      ].join(" "),
      inputSchema: z.object({
        content: z
          .string()
          .describe(
            "Markdown. New material only — never replay what the note already says. Be concrete: a fact you can act on later, not 'discussed the API'.",
          ),
      }),
      execute: async ({ content }) => {
        const entry = content.trim();
        if (!entry) return { error: "Nothing to write." };

        const path = dailyPath(new Date());
        const existing = await readText(bucket, botId, path);

        // The flush below replays the conversation, so the same conclusion can
        // arrive twice. Rejecting it unchanged is cheaper than letting the note
        // fill with duplicates.
        if (existing?.includes(entry)) {
          return { path, skipped: "That text is already in today's note." };
        }

        const header = existing ?? `# ${dayKey(new Date())}\n`;
        await writeText(bucket, botId, path, `${header.replace(/\s*$/, "")}\n\n${entry}\n`);

        return { path, saved: true };
      },
    }),

    search_memory: tool({
      description: [
        "Search your own memory files — every daily note, MEMORY.md and NOTES.md.",
        "Use it before saying you do not know something, and before redoing work you",
        "may already have done on an earlier day.",
      ].join(" "),
      inputSchema: z.object({
        query: z
          .string()
          .describe("Words to look for. A line matches when it contains all of them."),
        limit: z.number().int().min(1).max(50).optional().describe("Max matches, default 20."),
      }),
      execute: async ({ query, limit }) => {
        const terms = query
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        if (terms.length === 0) return { error: "Empty query." };

        const listed = await bucket.list({
          prefix: `${botPrefix(botId)}${DAILY_DIR}`,
          limit: SEARCH_FILE_LIMIT,
        });

        // Newest days first: recent memory is usually the answer.
        const paths = [
          NOTES_FILE,
          MEMORY_FILE,
          ...listed.objects
            .map((object) => object.key.slice(botPrefix(botId).length))
            .sort()
            .reverse(),
        ];

        const matches: { path: string; line: number; text: string }[] = [];
        const max = limit ?? 20;

        for (const path of paths) {
          if (matches.length >= max) break;

          const body = await readText(bucket, botId, path);
          if (!body) continue;

          const lines = body.split("\n");
          for (let index = 0; index < lines.length && matches.length < max; index += 1) {
            const line = lines[index] ?? "";
            const haystack = line.toLowerCase();
            if (terms.every((term) => haystack.includes(term))) {
              matches.push({ path, line: index + 1, text: line.trim().slice(0, 300) });
            }
          }
        }

        return matches.length
          ? { matches }
          : { matches: [], note: "Nothing in memory matches. You have not recorded this." };
      },
    }),
  };
}
