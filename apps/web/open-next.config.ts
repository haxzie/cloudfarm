import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Defaults are right for this app: every route is static or client-rendered,
 * so there is no ISR cache to configure and no server work to tune.
 */
export default defineCloudflareConfig();
