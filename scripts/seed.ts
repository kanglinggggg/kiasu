import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  const { transaction, pool } = await import("../src/lib/server/db");
  const { seedWorkspace } = await import("../src/lib/server/seed");
  try {
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(704202)");
      const exists = await c.query(
        "SELECT id FROM workspaces WHERE name='Remix Demo'",
      );
      if (exists.rowCount) {
        console.log("Demo already seeded; existing records preserved.");
        return;
      }
      await seedWorkspace(c);
      console.log("Seeded persistent Remix Demo.");
    });
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
