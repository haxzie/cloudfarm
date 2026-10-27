import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

/**
 * D1 bindings are per-request on Workers, so the client is built inside the
 * request lifecycle rather than at module scope.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
