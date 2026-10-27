import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { requireAuth, sessionMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Conservative hostname check — this value is interpolated into a URL. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const ONE_DAY = 60 * 60 * 24;

/**
 * Second-level labels that act as suffixes, so `foo.co.uk` reduces to
 * `foo.co.uk` rather than `co.uk`. Not the full public suffix list — just
 * enough to avoid the common wrong answer.
 */
const SUFFIX_LABELS = new Set(["co", "com", "net", "org", "ac", "gov", "edu", "or", "ne"]);

/**
 * `docs.mcp.cloudflare.com` -> `cloudflare.com`. Subdomains rarely serve their
 * own favicon, and keying on the main domain means one cached icon per brand.
 */
function mainDomain(host: string) {
  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const tld = labels.at(-1)!;
  const sld = labels.at(-2)!;

  return SUFFIX_LABELS.has(sld) ? labels.slice(-3).join(".") : `${sld}.${tld}`;
}

/**
 * Favicon cache for connector logos. First request for a host pulls the icon
 * from Google's favicon service and writes it to R2; afterwards it is served
 * from R2, so we aren't hotlinking a third party on every render.
 */
export const favicon = new Hono<AppEnv>()
  .use(sessionMiddleware, requireAuth)

  .get("/:host", async (c) => {
    const host = c.req.param("host").toLowerCase();
    if (!HOSTNAME.test(host) || host.length > 253) {
      throw new HTTPException(400, { message: "Invalid host" });
    }

    const domain = mainDomain(host);
    const key = `favicons/${domain}.png`;
    const cached = await c.env.ASSETS.get(key);
    if (cached) {
      return serve(cached.body, cached.httpMetadata?.contentType);
    }

    const upstream = await fetch(
      `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`,
      { cf: { cacheTtl: ONE_DAY } },
    );

    if (!upstream.ok) {
      throw new HTTPException(404, { message: "No icon" });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/png";
    const bytes = await upstream.arrayBuffer();

    await c.env.ASSETS.put(key, bytes, { httpMetadata: { contentType } });

    return serve(bytes, contentType);
  });

function serve(body: ReadableStream | ArrayBuffer | null, contentType = "image/png") {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${ONE_DAY}`,
    },
  });
}
