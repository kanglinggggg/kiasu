import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
loadEnvConfig(process.cwd());
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const url = new URL(process.env.DATABASE_URL),
    name = url.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error("Use a simple database name.");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const bootstrap = new Pool({ connectionString: admin.href });
  if (
    !(
      await bootstrap.query("SELECT 1 FROM pg_database WHERE datname=$1", [
        name,
      ])
    ).rowCount
  )
    await bootstrap.query(`CREATE DATABASE "${name}"`);
  await bootstrap.end();
  const db = new Pool({ connectionString: url.href });
  const c = await db.connect();
  try {
    await c.query("SELECT pg_advisory_lock(704201)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const file of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file]))
          .rowCount
      )
        continue;
      await c.query("BEGIN");
      try {
        await c.query(await readFile(`db/migrations/${file}`, "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
        await c.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(704201)");
    c.release();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
