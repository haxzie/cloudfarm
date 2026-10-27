# cloudfarm backend & agent harness — plan

Status: proposal, not yet implemented. Written 2026-10-25.

Goal: an agent harness where a user creates named bots, chats with them, and gives
them routines that run on their own — deployable by anyone with
`git clone && pnpm deploy` against their own Cloudflare account.

---

## 1. What the comparable products actually do

None of the three publish their orchestration code, so this is drawn from vendor
docs, launch material and user reports — treat it as the shape of the category,
not as verified internals.

**Grok Bot (xAI)** — the closest analogue to what we are building, and to the UI
we already have.

- Named, persistent bots. Each has a job, its own conversation, and context that
  accumulates. You create one by naming it and picking a shape and colour.
- A persistent cloud computer per account: browser, filesystem, command line.
  Sessions and files survive between tasks. Every bot on the account shares that
  machine; each gets its own "screen" for parallel work. Screens are work
  surfaces, explicitly *not* security boundaries.
- **Skills** = a written, repeatable procedure (often captured by watching the
  user do it once). **Routines** = a skill bound to one bot plus a schedule or an
  event trigger. Routines have run history, a Test action, and pause/resume.
- Credential vault, falling back to a connected password manager, falling back to
  asking the user through a secure form. The bot hands control back for SSO,
  passkeys, CAPTCHAs and device approvals.
- Approvals drawn at the point of irreversibility — send, buy, publish, delete,
  production changes. Everything up to that point runs unattended.
- Multi-bot: handoffs, group chats, a dispatcher that pulls in a human only for
  judgement calls.

**Instinct (Spear Street)** — same engine, opposite interface.

- Zero UI: one continuous thread over SMS/WhatsApp/voice. No projects, no
  workspace. Users both love and resent that.
- Persistent cloud computer with cached credentials; a model trained to drive a
  phone and a computer, so it works in services with no API.
- Proactive by design: follows up on dropped threads, messages you first.
- Strong authority model — its terms appoint it as your agent — with actions
  classified by risk and anything above a user-set level held for approval.
  Reportedly rejects any command that arrives unclassified.

**Muse (Meta)** — consumer assistant; the relevant part is memory.

- Remembers what was mentioned once and acts on it unprompted; the user can tell
  it to forget specific things. Memory is the product surface, not a hidden cache.

**The common architecture**, stripped of branding:

| Concern | Pattern |
| --- | --- |
| Identity | A durable, named agent per bot, with its own thread and state |
| Execution | Work continues server-side while the client is offline |
| Capability | Tools + MCP/plugins + a real browser + a shell |
| Repeatability | Skills (written procedure) → routines (schedule/trigger) |
| Safety | Risk-classified actions, approval gates at irreversibility |
| Trust | Credential vault, human takeover for auth the agent can't do |
| Continuity | Layered memory with explicit user control |
| Scale-out | Multiple bots, handoffs, a dispatcher |

Our existing UI already assumes most of this: bots with avatars, a chat thread,
and Routines/Files tabs in the info panel.

---

## 2. Mapping onto Cloudflare

The Agents SDK (`agents` package) covers a surprising amount of the harness, and
it is all Workers-native — which is what makes self-deployment realistic.

| Need | Primitive |
| --- | --- |
| A bot | `BotAgent extends AIChatAgent` — one Durable Object instance per bot |
| Conversation + working state | DO SQLite via `this.sql`, `setState` auto-syncs to clients |
| Live chat | WebSocket + `useAgent`/`useAgentChat`, resumable streaming |
| Routines | `this.schedule(cron, handler)` inside the bot DO (durable alarms) |
| A routine run | `AgentWorkflow` — durable steps, automatic retries |
| Approvals | `needsApproval` on tools (chat); `step.waitForEvent("approval", { timeout: "7d" })` (routines) |
| Long/offline work | Workflows; `runFiber()`/`stash()` for work that must survive DO eviction |
| Proactive messages | Server-driven turns (`saveMessages`), Web Push + VAPID |
| Integrations | Agents SDK MCP client; `McpAgent` if we expose our own |
| Email in/out | Agents email routing + Cloudflare Email Service |
| Web browsing | Browser Run binding (`createBrowserTools`, or low-level CDP) |
| Shell + filesystem | Sandbox SDK on Containers |
| Relational data | D1 + Drizzle (already wired) |
| Files | R2 |
| Retrieval | D1 FTS5 first, Vectorize when it stops being enough |
| Model access | AI Gateway in front of Anthropic (caching, retries, spend caps, logs) |
| Secrets | Workers Secrets Store for platform keys; envelope-encrypted rows in D1 for per-user credentials |

### Plan requirements (this decides our tiering)

Verified against current Cloudflare docs:

- **Containers** (the shell/filesystem "computer"): **Workers Paid only** — the
  Free row is N/A. $5/mo includes 25 GiB-hr memory, 375 vCPU-min, 200 GB-hr disk.
- **Browser Run**: Free = **10 minutes/day**, 3 concurrent browsers, 60s idle
  timeout (extendable to 20 min with `keep_alive`). Paid = unlimited hours, 200
  concurrent.
- Workers, Durable Objects (SQLite), Workflows, D1, R2, Cron Triggers all have
  usable free tiers.

So: **chat + tools + routines + memory run on the free tier. The cloud computer
does not.** Treat the computer as an optional capability the deployment detects
and advertises, never as a hard dependency.

---

## 3. Proposed architecture

```
apps/web (Next.js)  ──WebSocket──►  BotAgent DO  ──►  Workflows (routine runs)
      │                                  │                    │
      └──HTTP──►  Hono API (Worker)      ├─► tools: fetch, MCP, browser, sandbox
                        │                ├─► D1 (entities, runs, approvals, audit)
                        │                ├─► R2 (files, artifacts, transcripts)
                        └─► Better Auth  └─► AI Gateway ─► Claude
```

### 3.1 Objects

- **`BotAgent`** (DO, one per bot) — the harness. Holds the message history, the
  bot's charter (job, tone, boundaries), its distilled memory, its routine
  schedules, and the currently running work. Everything a bot does flows through
  here, including runs it started on a cron while nobody was connected.
- **`Workspace`** (DO, one per account) — account-scoped coordination: the shared
  computer session, integration tokens, cross-bot handoff queue, spend counters.
  Mirrors the Grok Bot model of *bots are separate, the machine is shared*.
- **`RoutineRun`** (Workflow, one per execution) — durable steps, retries,
  approval waits, and a transcript written to R2.

### 3.2 Where data lives — one rule

The split is the thing most likely to rot, so state it once:

- **DO SQLite is the system of record for a live conversation and in-flight work.**
  Messages, tool calls, scratch state, the current plan.
- **D1 is the index the UI queries.** Bots, routines, run summaries, pending
  approvals, file metadata, audit log, and a one-row-per-conversation preview for
  the sidebar.
- The DO projects into D1 (last message preview, run status) on write. The API
  never writes conversation state into D1 directly.

Rationale: the sidebar, routine lists and "what's waiting on me" views need
cross-bot queries that a per-bot DO can't answer; the chat loop needs local,
transactional, low-latency reads that D1 can't give.

### 3.3 D1 schema sketch (additive to the Better Auth tables)

```
bot              id, user_id, name, description, avatar_shape, avatar_color,
                 charter (system prompt), model, created_at, archived_at
bot_memory       id, bot_id, kind (fact|preference|boundary), body, source_run_id,
                 created_at, forgotten_at        -- "forget" = set forgotten_at
skill            id, user_id, name, summary, body_key (R2), version, created_at
routine          id, bot_id, skill_id, name, trigger_kind (cron|event|manual),
                 cron, timezone, event_match (json), input_hint, approval_policy,
                 paused_at, last_run_at, next_run_at
routine_run      id, routine_id, bot_id, workflow_id, status, trigger, started_at,
                 finished_at, transcript_key (R2), token_cost, error
approval         id, bot_id, run_id, tool_name, args (json), risk, state,
                 requested_at, decided_at, decided_by, reason
integration      id, user_id, kind (mcp|oauth), name, config (json),
                 secret_ref, scopes, connected_at
file             id, user_id, bot_id?, name, r2_key, mime, bytes, sha256,
                 indexed_at
audit            id, user_id, bot_id?, actor (user|bot|system), action,
                 target, metadata (json), at
```

### 3.4 The harness loop

Interactive (chat):

1. `onChatMessage` assembles the prompt: charter → active skills → distilled
   memory → retrieved file chunks → recent messages.
2. `streamText` with the tool registry; multi-step until the model stops or a
   step budget is hit.
3. Tools carrying risk are declared `needsApproval`; the client renders the gate.
4. Results and tool calls persist in DO SQLite; preview projects to D1.

Unattended (routine):

1. Cron alarm fires in `BotAgent` → `runWorkflow("RoutineRun", { routineId, ... })`.
2. The workflow runs the same loop, with each model turn and each tool call as a
   `step.do(...)` so failures retry instead of restarting the task.
3. Hitting an approval-gated action writes an `approval` row, notifies the user
   (push/email/in-thread), and parks on `step.waitForEvent("approval", { timeout: "7d" })`.
   Timeout is a real outcome: record "expired", don't act.
4. On finish it posts a message into the bot's thread as a server-driven turn, so
   the routine's output lands where the user already looks.

### 3.5 Tools, skills, and the registry

Three sources, one registry assembled per turn:

1. **Built-ins** — `fetch`/HTTP, R2 file read/write, D1 query over the user's own
   data, send-email, schedule-routine, remember/forget, handoff-to-bot.
2. **MCP** — the main extension path. Per-user MCP server connections through the
   Agents SDK client; tool names namespaced per server.
3. **Computer** — browser tools and sandbox exec, present only when the
   deployment has them (see tiering).

**Skills** are markdown procedures in R2 with a row in D1: name + one-line summary
always visible to the model, body loaded only when the model asks for it or a
routine names it. Same progressive-disclosure trick Claude Code uses for skills,
and the same unit Grok Bot schedules.

### 3.6 Risk model

Every tool declares a risk level, and the harness — not the model — enforces it:

- `read` — no gate.
- `write` — reversible, scoped to the user's own data. No gate by default.
- `irreversible` — send, publish, purchase, delete, production change, anything
  touching a third party. Always gated unless the user has pre-authorised that
  exact tool for that bot.

An unclassified tool is treated as `irreversible`. This is where Instinct's
"reject anything unclassified" instinct is worth copying.

Two hazards that deserve explicit design, not a sentence in a README:

- **Prompt injection.** A bot that reads web pages and email is reading attacker
  input. Content fetched by tools is wrapped and labelled as data; instructions
  found inside it never escalate risk level or satisfy an approval. Approvals are
  only ever granted by a user action in our UI.
- **Credential blast radius.** The model never sees secrets. A credential broker
  resolves `secret_ref` at the HTTP/browser layer and injects it; the transcript
  records that a credential was used, never its value. Sign-in flows the agent
  can't complete (SSO, passkeys, CAPTCHAs, device approvals) hand back to the
  human by design — we don't automate around them.

### 3.7 Memory

- **Working** — recent messages in the DO, trimmed by token budget.
- **Distilled** — facts, preferences and boundaries extracted after runs, stored
  as `bot_memory` rows and injected as a short block. Visible and deletable in the
  UI; "forget" sets `forgotten_at` and drops it from the prompt. Muse's lesson:
  make memory a surface, not a secret.
- **Retrieval** — files and transcripts chunked into D1 FTS5 to start. Vectorize
  only when keyword search demonstrably fails; it's another binding to provision
  for self-deployers.

### 3.8 Execution boundaries — what runs where

"Does the agent run in a sandbox" has three answers, because three different
things execute:

| What | Where | Isolation | Plan |
| --- | --- | --- | --- |
| The harness: prompt assembly, model calls, tool dispatch, state | `BotAgent` Durable Object | V8 isolate, one per bot. No filesystem, no subprocesses, no raw sockets — only the bindings we hand it | Free |
| Model-written code that orchestrates tools (Code Mode) | Worker Loader isolate, spawned per execution | Fresh ephemeral isolate; reaches only the tool bindings passed into the executor | Free |
| Shell commands, arbitrary code, a real filesystem, a browser | Sandbox SDK on Containers; Browser Run for the browser | Container per sandbox instance, each fronted by its own DO | Paid |

So the agent loop itself is **not** containerised, and does not need to be. It
runs our code, not the model's: the model emits tool calls as JSON, the harness
decides whether a call is permitted, and only then executes it. The isolate is
already a hard boundary — a Worker cannot read a filesystem or spawn a process,
so there is nothing for a container to additionally contain.

What does get sandboxed is anything the *model* authors or drives:

- **Code Mode** is the cheap middle tier and worth reaching for before containers.
  The model gets one "write code" tool and its JavaScript runs in a throwaway
  isolate wired only to the tools we expose, which is how it chains five tool
  calls with real control flow in one turn instead of five round trips. No
  container, works on Free.
- **Containers** are only for what needs a real machine: `pip install`, git, image
  conversion, running a repo's test suite.

### 3.9 Sandbox lifecycle and tenancy

This resolves what was open question 3.

**One sandbox per bot, ephemeral per run, with no durable state on its disk.**

Grok Bot shares one machine across every bot on the account and is candid that
the per-bot screens are not security boundaries. That is a deliberate product
trade — it lets one bot pick up where another left off — and it means a single
prompt-injected bot reaches every cached credential and browser session on the
account. We take the opposite default:

- A sandbox is created for a run and destroyed after it. Containers bill per 10ms
  of active time and scale to zero, so short-lived instances are the cheap case,
  not the expensive one.
- Durable artefacts live in R2 under the bot's prefix, not on the container disk.
  A run mounts what it needs and writes results back. Destroying a sandbox then
  costs nothing.
- Browser sessions are per run too. Logged-in state is re-established from the
  credential broker rather than cached in a long-lived profile, so there is no
  standing session for an injected instruction to ride.
- Cross-bot continuity is explicit: a handoff passes R2 keys and a written brief,
  not a shared machine.

The cost is latency (container cold start per run) and losing "bot B continues
bot A's half-finished work on the same desktop". Worth it: the shared persistent
machine is the single largest blast radius in this product category, and it is
much harder to retrofit isolation later than to relax it.

---

## 4. Self-deployability

The constraint that shapes everything: a stranger with a Cloudflare account and
an Anthropic key should get a working instance without reading our source.

- **One command.** `pnpm bootstrap` creates D1, R2, KV, the Vectorize index and
  queues, writes the ids into `wrangler.jsonc`, runs migrations, prompts for
  secrets (`BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, GitHub OAuth), then
  `wrangler deploy`. Idempotent — re-running adopts existing resources.
- **One Worker.** API, agent DOs, workflows and the Next.js front end ship as a
  single Worker with static assets, so there is one URL, one deploy, no CORS,
  and no second origin to configure. (This supersedes the current split-origin
  dev setup; Better Auth keeps its `/api/auth/*` mount.)
- **Deploy to Cloudflare button** in the README for the click path, with the
  bootstrap script as the scriptable equivalent.
- **Capability tiers, detected at boot** and surfaced in the UI rather than
  failing at runtime:

  | Tier | Needs | Gets |
  | --- | --- | --- |
  | Free | Workers Free + model key | Chat, tools, MCP, routines, memory, files, email-in |
  | Paid | Workers Paid ($5/mo) | + shell/filesystem sandbox, unmetered browsing, queues |

  Browser tools degrade rather than disappear on Free: 10 min/day is enough for
  occasional lookups, so the capability is advertised with its budget.
- **Bring your own model.** AI Gateway in front of Anthropic by default; the
  provider is a config value so a self-deployer can point at Workers AI or
  another provider. Default to the current Claude models and let the gateway
  handle caching and spend caps.
- **Cost guardrails on by default.** Per-bot and per-run token budgets, a monthly
  account cap, and routines that refuse to start when the cap is hit — a
  self-hosted agent that quietly bills $400 is a worse outcome than one that
  stops.

---

## 5. Milestones

Each one ends somewhere usable, not half-built.

| # | Scope | Done when |
| --- | --- | --- |
| M1 | `BotAgent` DO, real chat replacing mock data, streaming, persistence, bot CRUD in D1 | You can create a bot in the UI and hold a real conversation that survives reload |
| M2 | Tool registry, built-ins, risk classification, `needsApproval` gates in the UI | A bot can fetch, write files, and ask before anything irreversible |
| M3 | Skills + routines + `RoutineRun` workflow + run history + Test + pause/resume | A routine runs on a cron with the browser closed and posts its result into the thread |
| M4 | Memory (distil/inject/forget), file upload + retrieval, Files tab | A bot remembers a stated preference across runs and cites an uploaded file |
| M5 | MCP client + integration management + credential broker | A user connects an MCP server and the bot uses its tools without seeing the token |
| M6 | Computer tier: Browser Run tools + Sandbox SDK, capability detection | On a paid deploy a bot can browse and run a script; on free it degrades cleanly |
| M7 | Channels + multi-bot: email in/out, push, handoff, dispatcher | A routine emails you, you reply, and the bot continues |
| M8 | Self-deploy polish: bootstrap script, single-Worker deploy, button, budgets | A fresh account is live in one command |

M1–M3 is the product. M4–M8 is what makes it worth self-hosting.

---

## 6. Open questions

1. **Single Worker vs split.** Merging the Next.js app into the API Worker is the
   right call for self-deployment but changes the current two-app dev setup. Worth
   doing at M1 or deferring to M8?
2. **Threads.** Instinct's single endless thread vs Grok Bot's one-thread-per-bot.
   Our UI assumes per-bot. Do bots ever need multiple conversations?
3. ~~Shared vs isolated computer.~~ Settled in §3.9: per-bot, ephemeral per run,
   state in R2.
4. **Who pays for the model.** Self-deployers bring a key; does the hosted
   instance also support per-user keys?
5. **Teaching by demonstration.** Grok Bot's "watch me do it once" is the feature
   users rave about and by far the hardest to build. Out of scope until M8+, or
   is a cheap version (the bot drafts a skill from a transcript) worth doing at M3?
