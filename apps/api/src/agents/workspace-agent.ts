import { Agent, callable } from "agents";

export type ConnectorTool = {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * The connector list is not kept here. The SDK broadcasts MCP server state to
 * connected clients whenever it changes — including when an OAuth callback
 * lands — so a copy in agent state would only ever go stale.
 */
type WorkspaceState = Record<string, never>;

/**
 * One instance per user. Owns the account's MCP connections so every bot can
 * share them, rather than each bot holding its own copy.
 */
export class WorkspaceAgent extends Agent<Env, WorkspaceState> {
  initialState: WorkspaceState = {};

  @callable()
  async addConnector(
    name: string,
    url: string,
  ): Promise<{ ok: true; needsAuth: boolean } | { ok: false; error: string }> {
    const trimmedName = name.trim();
    if (!trimmedName) return { ok: false, error: "Give the connector a name" };

    const validation = validateHttpUrl(url);
    if ("error" in validation) return { ok: false, error: validation.error };

    const errors: string[] = [];

    // Streamable HTTP first, SSE second. The SDK's "auto" mode falls back to
    // SSE on any failure, which turns an OAuth 401 into a misleading
    // "expected text/event-stream" error and loses the authorization prompt.
    for (const type of ["streamable-http", "sse"] as const) {
      try {
        const result = await this.addMcpServer(trimmedName, validation.url, {
          // Where the OAuth callback comes back to.
          callbackHost: this.env.BETTER_AUTH_URL,
          transport: { type },
        });

        return { ok: true, needsAuth: result.state === "authenticating" };
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : "Could not connect");
        // A failed attempt leaves a stored row behind; clear it before retrying.
        await this.dropFailed(validation.url);
      }
    }

    return { ok: false, error: errors[0] ?? "Could not connect" };
  }

  private async dropFailed(url: string) {
    const { servers } = this.getMcpServers();
    for (const [id, server] of Object.entries(servers)) {
      if (server.server_url === url && String(server.state) !== "ready") {
        await this.removeMcpServer(id).catch(() => {});
      }
    }
  }

  @callable()
  async removeConnector(id: string): Promise<void> {
    await this.removeMcpServer(id);
  }

  // ── Tools for the bots ──────────────────────────────────────────────
  // Connections live here, one per account, so a bot borrows them rather than
  // opening its own (and re-doing every OAuth flow).

  /**
   * Tool definitions across every connected server, as JSON.
   *
   * JSON rather than objects because a tool's input schema is an arbitrary
   * record, which the Durable Object RPC types cannot express — they collapse
   * it to `never` and poison inference at the call site.
   */
  async mcpToolsJson(): Promise<string> {
    // A hub waking from hibernation restores its connections asynchronously;
    // without this the first turn after a deploy sees an empty tool list.
    await this.mcp.waitForConnections({ timeout: 10_000 }).catch(() => {});

    const tools: ConnectorTool[] = this.mcp.listTools().map((entry) => ({
      serverId: entry.serverId,
      name: entry.name,
      description: entry.description ?? "",
      inputSchema: entry.inputSchema as Record<string, unknown>,
    }));

    return JSON.stringify(tools);
  }

  /** Runs one of those tools and hands the result back to the bot, as JSON. */
  async callMcpToolJson(serverId: string, name: string, argsJson: string): Promise<string> {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const result = await this.mcp.callTool({ serverId, name, arguments: args });

    return JSON.stringify(result);
  }
}

/**
 * MCP also defines a stdio transport that runs a local process. There is no
 * local process to run on Workers, and accepting one would mean accepting a
 * command to execute — so only http(s) URLs are allowed.
 */
export function validateHttpUrl(input: string): { url: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter the server URL" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "That is not a valid URL. MCP servers must be reachable over HTTP." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      error: `Only HTTP MCP servers are supported — "${parsed.protocol}" transports (including stdio) can't run here.`,
    };
  }

  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && !isLocal) {
    return { error: "Use https for remote servers; plain http is only allowed on localhost." };
  }

  return { url: parsed.toString() };
}
