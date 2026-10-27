export type CatalogEntry = {
  id: string;
  name: string;
  url: string;
  description: string;
  /** Servers that sit behind OAuth need an authorisation round trip. */
  requiresAuth: boolean;
};

/**
 * Public HTTP MCP servers worth suggesting. Every URL here was probed and
 * answered as an MCP endpoint — either openly or with an OAuth challenge.
 */
export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    description: "Search Cloudflare's developer documentation.",
    requiresAuth: false,
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    description: "Ask questions about any public GitHub repository.",
    requiresAuth: false,
  },
  {
    id: "cloudflare-bindings",
    name: "Cloudflare Bindings",
    url: "https://bindings.mcp.cloudflare.com/mcp",
    description: "Manage Workers, KV, D1, R2 and other bindings.",
    requiresAuth: true,
  },
  {
    id: "cloudflare-observability",
    name: "Cloudflare Observability",
    url: "https://observability.mcp.cloudflare.com/mcp",
    description: "Query Workers logs and analytics.",
    requiresAuth: true,
  },
  {
    id: "cloudflare-radar",
    name: "Cloudflare Radar",
    url: "https://radar.mcp.cloudflare.com/mcp",
    description: "Internet traffic trends, URL scans and domain insight.",
    requiresAuth: true,
  },
  {
    id: "linear",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    description: "Read and update issues, projects and cycles.",
    requiresAuth: true,
  },
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    description: "Search and edit pages and databases.",
    requiresAuth: true,
  },
  {
    id: "sentry",
    name: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
    description: "Investigate errors, issues and releases.",
    requiresAuth: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    url: "https://mcp.stripe.com",
    description: "Look up customers, payments and subscriptions.",
    requiresAuth: true,
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp",
    description: "Repositories, issues and pull requests.",
    requiresAuth: true,
  },
  {
    id: "sequel",
    name: "Sequel",
    url: "https://api.sequel.sh/mcp",
    description: "Query your connected databases, warehouses and analytics.",
    requiresAuth: true,
  },
];
