import { Pool, PoolClient, types } from "pg";
types.setTypeParser(1700, Number);
types.setTypeParser(20, Number);
const globalDb = globalThis as typeof globalThis & { remixPool?: Pool };
export const pool =
  globalDb.remixPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalDb.remixPool = pool;
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='8s'");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
