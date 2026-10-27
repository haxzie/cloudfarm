import { S3Mount } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

/** Where the bot's R2 folder appears inside the sandbox. */
export const WORKSPACE = "/workspace";

/** Containers are billed while awake; let an idle one go. */
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

/** Keep a runaway command from holding the turn open. */
const DEFAULT_TIMEOUT_MS = 60_000;

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/**
 * One Linux sandbox per bot. The bot's folder in R2 (`bots/<botId>/`) is
 * mounted at /workspace, so anything written there is already durable — the
 * container is disposable, the folder is not.
 *
 * The sandbox never sees the R2 credentials: s3fs talks to an intercept that
 * hands each request to S3Gateway in the Worker, which signs it.
 */
export class BotSandbox extends DurableObject<Env> {
  private readonly container: Container;
  private readonly mounts: S3Mount;
  private mounted = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const container = ctx.container;
    if (!container) throw new Error("No container is configured");

    this.container = container;
    this.mounts = new S3Mount(container, ctx.exports.S3Gateway);

    if (container.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  /** Starts the container if needed and mounts this bot's R2 folder. */
  private async ready(botId: string) {
    if (!this.container.running) {
      this.container.start({
        image: this.container.images.sandbox,
        // The shell needs the network for curl and git.
        enableInternet: true,
      });
      await this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
      this.mounted = false;
    }

    if (this.mounted) return;

    await this.mounts.mount({
      mountPath: WORKSPACE,
      source: {
        type: "s3",
        endpoint: this.env.S3_ENDPOINT,
        region: "auto",
        bucket: this.env.S3_BUCKET,
        credentials: {
          type: "static",
          accessKeyId: this.env.S3_ACCESS_KEY_ID,
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        },
      },
      // One bot, one prefix. Each sandbox mounts exactly one.
      keyPrefix: `bots/${botId}`,
      access: "read-write",
    });

    this.mounted = true;
  }

  /** Runs a shell command in the bot's workspace. */
  async exec(botId: string, command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ExecResult> {
    await this.ready(botId);

    const process = await this.container.exec(["sh", "-lc", command], { cwd: WORKSPACE });

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs),
    );
    const finished = await Promise.race([process.output(), timeout]);

    if (finished === "timeout") {
      try {
        process.kill?.();
      } catch {
        // The command may have exited between the race and the kill.
      }
      return {
        exitCode: 124,
        stdout: "",
        stderr: `Command exceeded ${Math.round(timeoutMs / 1000)}s and was stopped.`,
        timedOut: true,
      };
    }

    const decoder = new TextDecoder();
    return {
      exitCode: finished.exitCode,
      stdout: decoder.decode(finished.stdout),
      stderr: decoder.decode(finished.stderr),
      timedOut: false,
    };
  }

  /** Unmounts and stops the container. */
  async shutdown() {
    if (!this.container.running) return;

    if (this.mounted) {
      await this.mounts.unmount(WORKSPACE).catch(() => {});
      this.mounted = false;
    }
    await this.container.destroy();
  }
}
