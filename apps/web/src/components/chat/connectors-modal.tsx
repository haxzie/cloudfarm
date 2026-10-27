"use client";

import { useAgent } from "agents/react";
import { Blocks, Compass, Loader2, Plug, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { API_HOST, API_URL } from "@/lib/api";
import { MCP_CATALOG, type CatalogEntry } from "@/lib/mcp-catalog";

export type Connector = {
  id: string;
  name: string;
  url: string;
  state: string;
  authUrl: string | null;
  error: string | null;
  toolCount: number;
};

/** Shape of the `cf_agent_mcp_servers` frame the SDK pushes. */
type McpServersFrame = {
  servers: Record<
    string,
    {
      name: string;
      server_url: string;
      auth_url: string | null;
      state: string;
      error: string | null;
    }
  >;
  tools: { serverId: string }[];
};

const STATE_LABELS: Record<string, string> = {
  connecting: "Connecting…",
  discovering: "Discovering tools…",
  authenticating: "Waiting for authorisation",
  failed: "Failed",
};

type AddResult = { ok: true; needsAuth: boolean } | { ok: false; error: string };

type Page = "installed" | "explore" | "add";

const PAGES: { id: Page; label: string; icon: typeof Blocks }[] = [
  { id: "installed", label: "Installed", icon: Blocks },
  { id: "explore", label: "Explore", icon: Compass },
];

const TITLES: Record<Page, string> = {
  installed: "Installed",
  explore: "Explore",
  add: "Add a connector",
};

/** Mounted only while open. */
export function ConnectorsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [page, setPage] = useState<Page>("installed");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [servers, setServers] = useState<McpServersFrame | null>(null);

  const agent = useAgent({
    agent: "workspace-agent",
    name: userId,
    host: API_HOST,
    // Pushed on connect and again on every MCP state change, including when an
    // OAuth callback completes in another tab.
    onMcpUpdate: (frame: McpServersFrame) => setServers(frame),
  });

  const connectors: Connector[] = Object.entries(servers?.servers ?? {}).map(([id, server]) => ({
    id,
    name: server.name,
    url: server.server_url,
    state: String(server.state),
    authUrl: server.auth_url,
    error: server.error,
    toolCount: (servers?.tools ?? []).filter((tool) => tool.serverId === id).length,
  }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function install(name: string, url: string, key: string) {
    setPending(key);
    setError(null);

    const result = (await agent.call("addConnector", [name, url])) as AddResult;

    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setPage("installed");
    return true;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connectors"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[34rem] max-h-full w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-200 bg-background shadow-2xl dark:border-neutral-800">
        <nav className="flex w-52 shrink-0 flex-col border-r border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="px-2 pt-1 pb-3 text-sm font-medium">Connectors</p>

          <ul className="flex flex-col gap-1">
            {PAGES.map(({ id, label, icon: Icon }) => {
              const isActive = page === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      setPage(id);
                      setError(null);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-neutral-200 font-medium dark:bg-neutral-800"
                        : "text-neutral-500 hover:bg-neutral-200/60 hover:text-foreground dark:hover:bg-neutral-800/60"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                    {id === "installed" && connectors.length > 0 && (
                      <span className="ml-auto text-[11px] text-neutral-500">
                        {connectors.length}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => {
              setPage("add");
              setError(null);
            }}
            className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            <Plus className="size-4" aria-hidden />
            Add new
          </button>
        </nav>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5 dark:border-neutral-800">
            <h2 className="text-sm font-medium">{TITLES[page]}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>
            )}

            {page === "installed" && (
              <InstalledPage
                connectors={connectors}
                onExplore={() => setPage("explore")}
                onRemove={(id) => void agent.call("removeConnector", [id])}
              />
            )}

            {page === "explore" && (
              <ExplorePage
                connectors={connectors}
                pending={pending}
                onInstall={(entry) => void install(entry.name, entry.url, entry.id)}
              />
            )}

            {page === "add" && (
              <AddPage
                busy={pending === "custom"}
                onSubmit={(name, url) => void install(name, url, "custom")}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function InstalledPage({
  connectors,
  onExplore,
  onRemove,
}: {
  connectors: Connector[];
  onExplore: () => void;
  onRemove: (id: string) => void;
}) {
  if (connectors.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Plug className="size-6 text-neutral-500" aria-hidden />
        <div>
          <p className="text-sm font-medium">No connectors yet</p>
          <p className="mt-1 text-xs text-neutral-500">
            Connect an MCP server to give your bots tools.
          </p>
        </div>
        <button
          type="button"
          onClick={onExplore}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
        >
          Explore servers
        </button>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {connectors.map((connector) => (
        <li
          key={connector.id}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
        >
          <ConnectorIcon url={connector.url} />
          <StateDot state={connector.state} />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{connector.name}</span>
            <span className="block truncate text-xs text-neutral-500">
              {connector.error ?? STATE_LABELS[connector.state] ?? connector.url}
            </span>
          </span>

          {connector.authUrl && connector.state !== "ready" && (
            <a
              href={connector.authUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs dark:border-neutral-700"
            >
              Authorise
            </a>
          )}

          <span className="shrink-0 text-[11px] text-neutral-500">
            {connector.toolCount} {connector.toolCount === 1 ? "tool" : "tools"}
          </span>

          <button
            type="button"
            onClick={() => onRemove(connector.id)}
            aria-label={`Remove ${connector.name}`}
            title="Remove"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200 hover:text-foreground dark:hover:bg-neutral-700"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ExplorePage({
  connectors,
  pending,
  onInstall,
}: {
  connectors: Connector[];
  pending: string | null;
  onInstall: (entry: CatalogEntry) => void;
}) {
  const installed = new Set(connectors.map((connector) => connector.url));

  return (
    <ul className="flex flex-col gap-1">
      {MCP_CATALOG.map((entry) => {
        const isInstalled = installed.has(entry.url);

        return (
          <li
            key={entry.id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
          >
            <ConnectorIcon url={entry.url} />

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{entry.name}</span>
                {entry.requiresAuth && (
                  <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    OAuth
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-neutral-500">{entry.description}</span>
            </span>

            <button
              type="button"
              disabled={isInstalled || pending !== null}
              onClick={() => onInstall(entry)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium disabled:opacity-40 dark:border-neutral-700"
            >
              {pending === entry.id && <Loader2 className="size-3 animate-spin" aria-hidden />}
              {isInstalled ? "Installed" : pending === entry.id ? "Connecting" : "Install"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AddPage({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (name: string, url: string) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit(String(form.get("name")), String(form.get("url")));
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Name</span>
        <input
          name="name"
          placeholder="Linear"
          required
          autoFocus
          className="rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-300 dark:border-neutral-700 dark:focus:border-neutral-600"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Server URL</span>
        <input
          name="url"
          placeholder="https://mcp.example.com/mcp"
          required
          className="rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-300 dark:border-neutral-700 dark:focus:border-neutral-600"
        />
        <span className="text-xs text-neutral-500">
          HTTP servers only — stdio servers run a local process, which Workers can&apos;t do.
        </span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="flex items-center justify-center gap-1.5 self-start rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
        {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

/** Favicon of the server's domain, cached in R2 by the API. */
function ConnectorIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);

  if (!host || failed) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800">
        <Plug className="size-3.5" aria-hidden />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 16px cached icon
    <img
      src={`${API_URL}/api/favicon/${host}`}
      alt=""
      width={28}
      height={28}
      className="size-7 shrink-0 rounded-md bg-neutral-100 object-contain p-1 dark:bg-neutral-800"
      onError={() => setFailed(true)}
    />
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function StateDot({ state }: { state: string }) {
  const tone =
    state === "ready"
      ? "bg-emerald-500"
      : state === "authenticating" || state === "connecting"
        ? "bg-amber-500"
        : "bg-red-500";

  return <span aria-hidden title={state} className={`size-2 shrink-0 rounded-full ${tone}`} />;
}
