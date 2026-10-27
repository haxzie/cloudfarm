import { defineConfig } from "drizzle-kit";

// Migrations are generated locally and applied with
// `wrangler d1 migrations apply`, which reads them from `migrations_dir`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
