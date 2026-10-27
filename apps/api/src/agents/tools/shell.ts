import { tool } from "ai";
import { z } from "zod";

import type { BotSandbox } from "../bot-sandbox";

/**
 * Shell access to the bot's sandbox. The working directory is the bot's R2
 * folder mounted at /workspace, so files survive the container.
 */
export function createShellTools(
  sandboxes: DurableObjectNamespace<BotSandbox>,
  botId: string,
) {
  const sandbox = sandboxes.getByName(botId);

  return {
    exec: tool({
      description: [
        "Run a shell command in your Linux sandbox. The working directory is",
        "/workspace, which is your own durable folder — files written there",
        "persist. Node 24, git, curl, jq and ripgrep are available.",
        "Long output is truncated, so pipe through head or grep.",
      ].join(" "),
      inputSchema: z.object({
        command: z.string().describe('e.g. ls -la, or node -e "console.log(1+1)"'),
      }),
      execute: async ({ command }) => {
        try {
          const result = await sandbox.exec(botId, command);
          return {
            exitCode: result.exitCode,
            stdout: truncate(result.stdout),
            stderr: truncate(result.stderr),
            ...(result.timedOut ? { timedOut: true } : {}),
          };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Sandbox unavailable";
          return {
            error: `The sandbox could not run that: ${message}`,
          };
        }
      },
    }),
  };
}

const MAX_OUTPUT_CHARS = 8_000;

function truncate(text: string) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…truncated (${text.length} chars total)`;
}
