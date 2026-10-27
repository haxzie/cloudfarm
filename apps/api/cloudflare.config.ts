import { bindings, defineConfig, defineContainer, defineWorker, exports } from "cf/config";
// The import attribute lets cf read this module's exports, so the Durable
// Object bindings below infer their class types instead of `unknown`.
import * as entrypoint from "./src/index" with { type: "cf-worker" };

/**
 * The Linux sandbox each bot gets. `BotSandbox` starts it on demand and mounts
 * the bot's R2 folder into it — see src/agents/bot-sandbox.ts.
 */
const sandbox = defineContainer({
  name: "cloudfarm-bot-sandbox",
  schedulingPolicy: "durable-object",
  images: {
    sandbox: { dockerfile: "./Dockerfile" },
  },
});

/**
 * Split out so the Durable Object bindings can point at it. A binding that
 * names the Worker as a string only knows the class exists; one that references
 * this object infers the class, so `env.BotAgent` is typed.
 *
 * `exports` replaces Wrangler's `migrations` array — each class declares its
 * own storage instead of accumulating migration tags.
 */
const self = defineWorker({
  name: "cloudfarm-api",
  compatibilityDate: "2026-10-19",
  // Better Auth and the Agents SDK both rely on AsyncLocalStorage.
  compatibilityFlags: ["nodejs_compat"],
  entrypoint,
  observability: { enabled: true },
  // Served from the apex's `api` subdomain rather than workers.dev, so the
  // auth cookie is set on a cloudfarm.dev host and the browser keeps it.
  // `domains` is the custom-domain key; `triggers.fetch()` is for routes.
  domains: ["api.cloudfarm.dev"],
  exports: {
    // One per bot: conversation, state, tools.
    BotAgent: exports.durableObject({ storage: "sqlite" }),
    // One per user: the account's MCP connections.
    WorkspaceAgent: exports.durableObject({ storage: "sqlite" }),
    // One per bot: its container, with the bot's R2 folder mounted.
    BotSandbox: exports.durableObject({ storage: "sqlite", container: sandbox }),
  },
});

export default defineConfig({
  worker: {
    ...self,

    env: {
      // The deployed origins. Local dev overrides both in .dev.vars.
      BETTER_AUTH_URL: bindings.text("https://api.cloudfarm.dev"),
      WEB_URL: bindings.text("https://cloudfarm.dev"),

      // S3 view of the R2 bucket, used to mount each bot's folder in its
      // sandbox. The host is <ACCOUNT_ID>.r2.cloudflarestorage.com.
      S3_ENDPOINT: bindings.text(
        "https://dbc43b99850cce79e60068b29c489278.r2.cloudflarestorage.com",
      ),
      S3_BUCKET: bindings.text("cloudfarm-assets"),

      DB: bindings.d1({
        name: "cloudfarm-db",
        // From `cf d1 list`. Not a secret — D1 ids are account-scoped handles.
        id: "cdfaf7a4-c3ec-475b-95ac-c485d545b7f8",
      }),
      ASSETS: bindings.r2({ name: "cloudfarm-assets" }),

      BotAgent: bindings.durableObject({ worker: self, exportName: "BotAgent" }),
      WorkspaceAgent: bindings.durableObject({ worker: self, exportName: "WorkspaceAgent" }),
      // No BotSandbox binding: a self-referential Durable Object binding makes
      // cf emit a `script_name`, and a container cannot attach to a Durable
      // Object wrangler then believes lives in another Worker. The agent
      // reaches it through `ctx.exports.BotSandbox` instead.

      // Browser Run powers the browser tools; the loader runs the code they
      // write, and the sandbox's shell.
      BROWSER: bindings.browser(),
      LOADER: bindings.workerLoader(),

      // Set in .dev.vars locally, and with `cf secret put` for a deployment.
      BETTER_AUTH_SECRET: bindings.secret(),
      ANTHROPIC_API_KEY: bindings.secret(),
      GITHUB_CLIENT_ID: bindings.secret(),
      GITHUB_CLIENT_SECRET: bindings.secret(),
      // From an R2 API token with Object Read & Write.
      S3_ACCESS_KEY_ID: bindings.secret(),
      S3_SECRET_ACCESS_KEY: bindings.secret(),
    },
  },

  containers: [sandbox],
});
