import { tool } from "ai";
import { z } from "zod";

/** Everything a bot owns lives under this prefix in R2. */
export function botPrefix(botId: string) {
  return `bots/${botId}/`;
}

/** Rejects traversal and absolute paths before they reach a key. */
function resolveKey(botId: string, path: string): string | null {
  const cleaned = path.replace(/^\/+/, "").trim();
  if (!cleaned || cleaned.split("/").some((part) => part === "." || part === "..")) {
    return null;
  }
  return `${botPrefix(botId)}${cleaned}`;
}

const MAX_READ_BYTES = 128 * 1024;

export type BotFile = {
  path: string;
  bytes: number;
  uploadedAt: string;
};

/** Every file the bot owns, newest listing first. */
export async function listBotFiles(bucket: R2Bucket, botId: string, folder?: string) {
  const prefix = folder
    ? resolveKey(botId, folder.replace(/\/*$/, "/"))
    : botPrefix(botId);
  if (!prefix) return null;

  const listed = await bucket.list({ prefix, limit: 1000 });
  return listed.objects.map((object) => ({
    path: object.key.slice(botPrefix(botId).length),
    bytes: object.size,
    uploadedAt: object.uploaded.toISOString(),
  }));
}

export async function readBotFile(
  bucket: R2Bucket,
  botId: string,
  path: string,
): Promise<{ path: string; content: string } | { error: string }> {
  const key = resolveKey(botId, path);
  if (!key) return { error: "That path is not allowed." };

  const object = await bucket.get(key);
  if (!object) return { error: `No file at ${path}.` };
  if (object.size > MAX_READ_BYTES) {
    return {
      error: `${path} is ${object.size} bytes, over the ${MAX_READ_BYTES} byte read limit.`,
    };
  }

  return { path, content: await object.text() };
}

/**
 * File tools backed directly by R2. The same objects are what the sandbox sees
 * at /workspace, so a file written here is visible to the shell and vice versa
 * — without paying for a container just to read a file.
 */
export function createFileTools(bucket: R2Bucket, botId: string) {
  return {
    list_files: tool({
      description:
        "List files in your workspace. Optionally pass a folder to list only what is under it.",
      inputSchema: z.object({
        folder: z.string().optional().describe("Folder to list, e.g. notes/"),
      }),
      execute: async ({ folder }) => {
        const files = await listBotFiles(bucket, botId, folder);
        if (!files) return { error: "That path is not allowed." };

        return files.length ? { files } : { files: [], note: "No files yet." };
      },
    }),

    read_file: tool({
      description: "Read a UTF-8 text file from your workspace.",
      inputSchema: z.object({ path: z.string().describe("e.g. notes/todo.md") }),
      execute: ({ path }) => readBotFile(bucket, botId, path),
    }),

    write_file: tool({
      description:
        "Write a UTF-8 text file to your workspace, replacing it if it exists. Folders are implicit.",
      inputSchema: z.object({
        path: z.string().describe("e.g. notes/todo.md"),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        const key = resolveKey(botId, path);
        if (!key) return { error: "That path is not allowed." };

        await bucket.put(key, content, {
          httpMetadata: { contentType: "text/plain; charset=utf-8" },
        });
        return { path, bytes: content.length, saved: true };
      },
    }),

    delete_file: tool({
      description: "Delete a file from your workspace.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const key = resolveKey(botId, path);
        if (!key) return { error: "That path is not allowed." };

        await bucket.delete(key);
        return { path, deleted: true };
      },
    }),
  };
}
