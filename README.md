# cloudfarm

AI teammates that each get their own computer. A bot is a persistent agent with
a durable conversation, a workspace in R2, a Linux shell, a browser, and the
memory it writes for itself between sessions.

Everything runs on Cloudflare: Workers, Durable Objects, D1, R2, Containers,
Browser Run and Worker Loader. There is no other infrastructure.

```
apps/
  web/   Next.js 16 (App Router) + Tailwind v4 — chat UI and the workbench
  api/   Hono on Workers — auth, bot CRUD, and the agents themselves
packages/
  bot-avatar/  generated bot faces (shapes, palette, gooey SVG + 3D CSS)
```

## Architecture

### The shape of it

```
            cloudfarm.dev                        api.cloudfarm.dev
         ┌─────────────────┐                  ┌────────────────────┐
         │  cloudfarm-web  │  fetch + WS      │   cloudfarm-api    │
         │  Next (OpenNext)│ ───────────────► │  Hono Worker       │
         └─────────────────┘                  └─────────┬──────────┘
                                                        │
                        ┌───────────────────────────────┼───────────────────┐
                        ▼                               ▼                   ▼
                 ┌─────────────┐               ┌────────────────┐   ┌──────────────┐
                 │  BotAgent   │  one per bot  │ WorkspaceAgent │   │  D1 + R2     │
                 │  (DO+SQLite)│               │  one per user  │   │  rows, files │
                 └──────┬──────┘               └───────┬────────┘   └──────────────┘
                        │                              │
      ┌─────────────────┼──────────────────┐           │ MCP (streamable-http / SSE)
      ▼                 ▼                  ▼           ▼
┌────────────┐   ┌─────────────┐   ┌──────────────┐  ┌──────────────────┐
│ BotSandbox │   │ Browser Run │   │ Worker Loader│  │ connected servers│
│ container  │   │  CDP tabs   │   │  Code Mode   │  └──────────────────┘
│ /workspace │   └─────────────┘   └──────────────┘
└─────┬──────┘
      │ s3fs, signed by S3Gateway in the Worker
      ▼
   R2 bots/<id>/
```

### Three Durable Objects

Everything stateful is a Durable Object, because each one is a single-threaded
actor with its own storage — which is exactly the shape of "one bot, one
conversation, one computer".

**`BotAgent`** — one instance per bot, addressed by bot id. It owns the thread
(SQLite), the model loop, and every tool. Its `state` is synced to connected
browsers over a WebSocket by the Agents SDK, so the UI re-renders when the bot
writes, with no polling and no endpoint to call. Replies are generated in full
and then persisted rather than streamed to the client; the model call itself
streams so a long answer cannot trip an HTTP timeout.

**`WorkspaceAgent`** — one per user. It owns the account's MCP connections, so
signing into a server happens once and every bot inherits it. Tool definitions
and calls cross between the two agents as JSON strings, because Durable Object
RPC types collapse arbitrary records to `never` and that poisons the AI SDK's
tool inference.

**`BotSandbox`** — one per bot. Starts the container on demand, mounts the
bot's R2 folder at `/workspace`, and sleeps after ten idle minutes.

### What a turn does

1. `sendMessage` appends the user message, flips `status` to `thinking`, and
   clears the browser action log so the workbench shows this run only.
2. The system prompt is assembled fresh: a fixed base, the memory discipline,
   the bot's name/description/charter from D1, then its `NOTES.md`,
   `MEMORY.md` and the last two days of notes — under an 8k/file, 20k total
   budget.
3. `streamText` runs with up to 60 tool steps.
4. The reply is persisted, `status` returns to `idle`, and the client re-renders
   from synced state.
5. Housekeeping runs after delivery: a silent memory flush, then compaction if
   the live window has grown past 32 messages or 160k characters.

### The bot's computer

Every tool is assembled fresh on each turn in `BotAgent.tools()`, so a connector
added mid-conversation is available on the next message. The model gets up to
**60 tool steps** per turn — set high so a long task finishes in one turn
instead of stopping half-done; the ceiling only binds runaways.

#### Files — R2, no container

`apps/api/src/agents/tools/files.ts`

Everything a bot owns lives under `bots/<botId>/` in one R2 bucket.
`list_files`, `read_file`, `write_file` and `delete_file` hit R2 directly from
the Worker, so reading a file costs no container and no cold start.

Every path goes through `resolveKey`, which strips leading slashes and rejects
any segment that is `.` or `..`, so a bot cannot escape its own prefix. Reads
cap at **128 KB** and return a clear error rather than a truncated file, since
a silently cut file is worse than a refusal.

The owner sees the same tree in the workbench's Files tab — `listBotFiles` and
`readBotFile` are shared by the tools and the panel's RPCs, so there is one
code path and no chance of them disagreeing.

#### Shell — a container per bot

`apps/api/src/agents/tools/shell.ts`, `apps/api/src/agents/bot-sandbox.ts`

`exec` runs a command in the bot's own Linux container. `BotSandbox` starts it
on first use, sets a **10-minute inactivity timeout** (containers bill while
awake), and mounts the bot's R2 folder at `/workspace`. Commands time out after
**60 seconds** and output is truncated at **8,000 characters** — enough for a
build log's tail, short of flooding the context.

The mount is the interesting part. `s3fs` inside the container speaks the S3
protocol, but the container never receives the R2 credentials:

```ts
this.mounts = new S3Mount(container, ctx.exports.S3Gateway);
```

s3fs talks to an intercept, which hands each request to `S3Gateway` running in
the Worker, which signs it. So a compromised sandbox cannot exfiltrate a key, and
the shell and the file tools operate on the same bytes — write a file with
`write_file`, `cat` it in the shell.

This is also why the image is custom (`apps/api/Dockerfile`): `s3fs` and `fuse3`
are not in any stock image, and the Sandbox SDK needs its `sandbox-shim` helper
copied in. The container uses the `durable_object` scheduling policy, which is
what ties one container to one bot.

#### Browser — Browser Run over CDP

One Browser Run session per bot, `{ mode: "reuse", key: "main" }`, with a
**10-minute keep-alive** — Browser Run closes an idle session after about a
minute, which is shorter than the gap between two messages, so a login or a
half-finished form would not survive otherwise.

The model does not get a fixed set of click/type tools. It gets a `cdp` binding
through Code Mode and writes raw CDP against it, which means the whole protocol
is available rather than a curated subset. A typical step opens a target,
attaches, evaluates in the page and captures a screenshot in one execution.

Every browser call is wrapped by `withBrowserLog`, which records the tool, a
summary of its input, whether it succeeded, and the error if not. That list is
agent state, so it streams to the workbench; it is cleared at the start of each
turn, because last turn's steps are about a page the bot has moved on from.

The workbench preview is a **CDP screenshot poll**, not Live View: Live View is
an interactive handover surface and under local dev resolves to the raw DevTools
frontend. Screenshots look the same in development and production. Captures use
the compositor surface (the default) — `fromSurface: false` never times out but
returns a constant blank frame on the Chrome build Browser Run ships. A
never-painted `about:blank` tab hangs instead, so there is a 4-second timeout
and one `Page.bringToFront` retry; real pages capture on the fast path without
stealing focus from the bot.

#### MCP connectors — one sign-in per account

`apps/api/src/agents/workspace-agent.ts`

Connections live on the user's `WorkspaceAgent`, not on each bot, so signing
into a server once makes it available to every bot the user owns. HTTP
transports only — stdio would mean running someone else's binary.

Adding a server tries **`streamable-http` first, then `sse`**, dropping the
failed row in between. Order matters: the SDK's `auto` transport falls back to
SSE on any failure, which turns an OAuth `401` into a misleading
`SSE error: Invalid content type, expected "text/event-stream"` and hides the
fact that the server simply wants you to sign in.

Connector state is **not** mirrored into agent state. An earlier version kept a
snapshot and it went stale the moment OAuth completed, leaving the UI stuck on
"connecting"; the SDK already broadcasts changes through `onMcpUpdate`, so the
UI is driven from that instead.

#### Code Mode — why tools are not spread into the prompt

Both MCP tools and the browser go through
[Code Mode](https://blog.cloudflare.com/code-mode/) rather than being exposed as
individual function schemas.

A handful of connected servers is dozens of JSON schemas re-sent on every step.
That crowds the context and measurably worsens the model's choice of tool. So
the model gets **one `apps` tool** instead, plus the ability to write JavaScript
that calls the real ones. The code runs in a throwaway Worker through the Worker
Loader binding, with the connectors injected. Chaining three calls becomes one
step rather than three, and intermediate results never have to round-trip
through the context window at all.

Tool names are namespaced per server and sanitised to `[a-zA-Z0-9_-]`, capped at
64 characters, so two servers both offering `search` do not collide.

### Memory

`apps/api/src/agents/tools/memory.ts`

The model only remembers what it writes down. Memory is plain Markdown in the
bot's own R2 workspace — no hidden store, visible and editable by the owner in
the Files tab, and reachable by the bot's ordinary file tools. The design
follows [OpenClaw](https://docs.openclaw.ai/concepts/memory): three layers,
separated by how long they should live.

| File | Role | Loaded |
| --- | --- | --- |
| `memory/YYYY-MM-DD.md` | Working layer. Raw findings, observations, what was tried. | Today + yesterday |
| `MEMORY.md` | Durable layer. Curated facts and standing decisions. | Every turn |
| `NOTES.md` | Operating layer. Conventions, lessons, mistakes not to repeat. | Every turn |

Two tools, because the curated files are just files and the ordinary
`read_file`/`write_file` already handle them:

- **`remember`** appends to today's note. Append-only, and it rejects content
  already present verbatim — the flush below replays the conversation, so the
  same conclusion can arrive twice.
- **`search_memory`** matches across every note, newest day first. A line
  matches when it contains all the query's terms. No embeddings: the corpus is
  one bot's notes, and substring matching over it is both cheap and predictable.

Injection is budgeted at **8,000 characters per file, 20,000 total**. Over
budget, files are cut at a boundary with a notice that they are intact on disk —
truncation is a signal to distill `MEMORY.md`, not data loss. Dates are UTC
everywhere, because a stable key matters more than a local one.

The system prompt tells the bot to write as it works rather than at the end, to
be concrete ("the staging API rejects requests without an `X-Env` header", not
"looked into the API"), and to leave credentials out unless asked to keep them.

### Compaction

A long thread cannot be sent in full forever. Both mechanisms below run **after**
the reply is delivered, so the owner never waits on housekeeping.

**The flush comes first.** Every 24 messages, a silent turn runs with only the
memory tools exposed and a private copy of the conversation, asking the bot to
record anything durable and to answer `NO_REPLY` if there is nothing worth
keeping. Its messages are never persisted, so they never appear in the chat or in
a later turn — but its writes are ordinary files. Ordering is deliberate:
compaction is lossy, and the notes taken before it are not.

**Then compaction.** Once the live window passes **32 messages or 160,000
characters** — whichever comes first, because a handful of long tool-heavy
replies can outweigh fifty short ones — everything older than the most recent
**16 messages** is summarized into one entry, and the boundary records the last
message it covers.

The summary is written under fixed headings (Context, Decisions, Facts, Work
done, Open) and two rules that matter:

- **Identifiers are copied character for character.** A summary that paraphrases
  an API key, a file path or an account id has destroyed it.
- **Summaries chain.** Each one carries the previous forward, because it is the
  only remaining record of what came before.

The summarizer's input is budgeted too: 2,000 characters per message, 120,000
total, filled newest-first, with `[N older messages omitted]` marking any gap so
the model does not invent what was dropped. An empty summary, or one cut short by
the output limit, is **rejected** — the boundary is not written and the history
stays intact, with a retry gap so a failing summarizer costs one request every
few turns rather than every turn.

Later turns then send the summary — in the **system prompt**, so the model never
mistakes it for something the owner said — plus the verbatim tail. Nothing is
deleted: every message stays in the Durable Object's SQLite and on screen.
Compaction only changes what the model is shown.

### Web

The chat UI is a client app talking to the API over `fetch` and one WebSocket
per open bot. The right-hand **workbench** is the bot's computer: a Files tab
(tree plus preview) and a Browser tab (a CDP screenshot poll above a per-run
action log). Bot avatars are generated from a seed in `packages/bot-avatar` —
Catmull-Rom shapes through a gooey SVG filter, with eyes that track in 3D CSS.
Shapes that touch merge, which is why they are never overlapped.

### Deployment

Two Workers from one repo, both auto-deployed from `main`. The web Worker builds
on Cloudflare Workers Builds; the API builds in GitHub Actions, because its
container image needs a Docker daemon and Cloudflare's builders have none.
See [docs/deploy.md](docs/deploy.md).

## Prerequisites

- Node.js >= 22, pnpm 10
- A Cloudflare account (only needed to deploy or to use a remote D1 database)

## Setup

```bash
pnpm install

# API secrets for local dev
cp apps/api/.dev.vars.example apps/api/.dev.vars
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" > apps/api/.dev.vars

# Web env
cp apps/web/.env.example apps/web/.env.local

# Create your own D1 database and put the id in apps/api/cloudflare.config.ts
pnpm --filter api exec cf d1 create cloudfarm-db

# Apply migrations to the local D1 instance
pnpm --filter api db:migrate
```

## Development

```bash
pnpm dev          # web on :3101 and api on :8797
pnpm dev:web
pnpm dev:api
```

| Command | Description |
| --- | --- |
| `pnpm build` | Build both apps (`next build`, `cf build`) |
| `pnpm typecheck` | `tsc --noEmit` in every app |
| `pnpm lint` | ESLint |
| `pnpm deploy:api` | `cf deploy` (needs a Docker daemon for the sandbox image) |
| `pnpm deploy:web` | `opennextjs-cloudflare deploy` |

## Auth

Better Auth lives entirely in the API and is mounted at `/api/auth/*`
(`apps/api/src/index.ts`). D1 bindings only exist per request on Workers, so the
Drizzle client and the Better Auth instance are built inside a middleware
(`apps/api/src/middleware/auth.ts`) rather than at module scope.

- `withAuth` puts `db` and `auth` on the Hono context
- `sessionMiddleware` resolves the current session onto `c.var.user` / `c.var.session`
- `requireAuth` returns 401 when there is no session — see `apps/api/src/routes/me.ts`

The web app talks to it through the React client in
`apps/web/src/lib/auth-client.ts`, pointed at `NEXT_PUBLIC_API_URL`. Because the
two run on different origins, the API sends credentialed CORS for `WEB_URL` and
Better Auth trusts that same origin.

### GitHub sign-in

GitHub is the only sign-in method. One button handles sign-in and sign-up:
Better Auth creates the account on the first GitHub callback and signs the user
in on every one after that.

1. Create an OAuth app at <https://github.com/settings/developers>
2. Authorization callback URL — the **API** origin, not the web app:
   `http://localhost:8797/api/auth/callback/github`
3. Put the credentials in `apps/api/.dev.vars`:

   ```
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

   Restart `cf dev` afterwards — it does not hot-reload `.dev.vars`.

For production use `cf secret put GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET`, and add the deployed callback URL to the OAuth app. If
you use a GitHub App rather than an OAuth app, grant it read-only access to
email addresses or the callback fails with `email_not_found`.

To add more providers, extend `socialProviders` in `apps/api/src/lib/auth.ts`,
add the vars to `.dev.vars`, and rerun `pnpm --filter api cf-typegen`. Account
linking is already on with GitHub as a trusted provider, so a second provider
attaches to the existing user when the verified emails match.

## Database

Drizzle schema lives in `apps/api/src/db/`. `auth.schema.ts` is generated by the
Better Auth CLI — don't hand-edit it; add application tables in their own files
and re-export them from `schema.ts`.

```bash
cd apps/api
pnpm auth:generate      # regenerate auth.schema.ts after changing the auth config
pnpm db:generate        # drizzle-kit generate -> drizzle/*.sql
pnpm db:migrate         # apply to local D1
pnpm db:migrate:remote  # apply to Cloudflare D1
```

Migrations are applied with `cf d1 migrations apply <database-id> --dir drizzle`.
Unlike Wrangler, `cf` identifies the database by id rather than by binding name,
so set `CLOUDFARM_D1_ID` or pass it yourself.

## Deploying

Both Workers deploy from `main` automatically — the web app through Cloudflare
Workers Builds, the API through GitHub Actions. The API cannot build on Workers
Builds: its container image needs a Docker daemon and Cloudflare's builders do
not have one.

[docs/deploy.md](docs/deploy.md) has the full runbook — the six Worker secrets,
the custom domains, the GitHub OAuth callback, and the remote D1 migration.

The API is configured in `apps/api/cloudflare.config.ts` through the `cf` CLI,
not `wrangler.jsonc`: bindings are typed function calls, Durable Object classes
declare their storage under `exports` instead of accumulating migration tags,
and custom domains go in `domains` (`triggers.fetch()` is for routes).
`pnpm --filter api cf-typegen` regenerates the binding types.

The web app is a Next build wrapped by `@opennextjs/cloudflare`, with its own
`wrangler.jsonc`. `NEXT_PUBLIC_API_URL` must be a **build-time** variable —
Next inlines `NEXT_PUBLIC_*` at build time, so a runtime binding is never read.
