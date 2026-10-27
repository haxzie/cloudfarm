# Deploying cloudfarm

Two Workers, both built from this repo by **Cloudflare Workers Builds**:

| Worker | Root directory | Build | Deploy |
| --- | --- | --- | --- |
| `cloudfarm-api` | `apps/api` | `pnpm install && pnpm build` | `pnpm exec cf deploy` |
| `cloudfarm-web` | `apps/web` | `pnpm install && pnpm build:cf` | `pnpm exec wrangler deploy` |

Workers Builds is used rather than GitHub Actions for one concrete reason: the
API's container image is built from `apps/api/Dockerfile`, and image builds need
a Docker daemon. Cloudflare's builders have one; a bare Actions runner does not.

## One-time setup

### 1. Account resources

Already created:

- D1 `cloudfarm-db` — `cdfaf7a4-c3ec-475b-95ac-c485d545b7f8`, wired into
  `apps/api/cloudflare.config.ts`.
- R2 `cloudfarm-assets` — every bot's workspace lives under `bots/<id>/`.

### 2. API secrets

`cf secret put <NAME>` from `apps/api`, or the dashboard. None are in the repo.

| Secret | Where it comes from |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | the GitHub OAuth app below |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | an R2 API token with Object Read & Write |

The R2 pair is what the sandbox mount uses. Without it `exec` fails with
`source.endpoint must be a valid URL` — the shell is the only thing affected.

### 3. GitHub OAuth app

Sign-in is GitHub-only. Create an OAuth app whose callback is
`https://<api-host>/api/auth/callback/github`. The local app points at
`localhost:8787`, so production needs its own.

### 4. Database

    cd apps/api
    CLOUDFARM_D1_ID=cdfaf7a4-c3ec-475b-95ac-c485d545b7f8 pnpm db:migrate:remote

### 5. Connect the repo

In the dashboard, **Workers → Create → Connect Git**, once per Worker, using the
table at the top. This is the step that cannot be scripted: it mints a GitHub
App grant, and `cf builds workers create` requires a `--git-repository-grant-id`
that only that flow produces.

Set two build-time variables on `cloudfarm-web`:

- `NEXT_PUBLIC_API_URL` — the deployed API origin. Next inlines `NEXT_PUBLIC_*`
  at build time, so this must be a *build* variable; a runtime binding is never
  read.
- `NPM_FLAGS=--version` or equivalent is not needed; pnpm is detected from
  `packageManager` in the root `package.json`.

### 6. Cross-origin settings

The two Workers are different origins, so after the first deploy set on the API:

- `WEB_URL` — the web Worker's origin, for CORS and auth redirects.
- `BETTER_AUTH_URL` — the API's own origin.

Both are plain `bindings.text(...)` in `apps/api/cloudflare.config.ts`.

## Deploying by hand

    pnpm --filter api deploy     # needs Docker running locally
    pnpm --filter web deploy

## Notes

- Containers require a **Workers Paid** plan.
- Dropping `defineContainer` from `apps/api/cloudflare.config.ts` removes the
  Docker requirement entirely, at the cost of the bot's `exec` tool.
