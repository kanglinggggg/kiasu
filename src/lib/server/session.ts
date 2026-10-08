import { createHash, randomBytes } from "node:crypto";
import { PoolClient } from "pg";
import { Actor, assertDomain } from "./domain";
import { one } from "./service";
export const sessionHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function localOnly(request: Request) {
  const url = new URL(request.url),
    hostUrl = new URL(
      `${url.protocol}//${request.headers.get("host") ?? url.host}`,
    ),
    loopbacks = ["127.0.0.1", "localhost", "[::1]"];
  assertDomain(
    process.env.LOCAL_DEMO === "true" &&
      loopbacks.includes(url.hostname) &&
      loopbacks.includes(hostUrl.hostname),
    "Local demo identities are disabled outside the local website.",
    403,
  );
  const origin = request.headers.get("origin");
  assertDomain(
    !origin || origin === hostUrl.origin,
    "Cross-origin writes are not allowed.",
    403,
  );
}
export function tokenFrom(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("remix_session="))
      ?.slice("remix_session=".length) ?? ""
  );
}
export async function actorFor(c: PoolClient, request: Request) {
  const token = tokenFrom(request);
  assertDomain(
    /^[a-f0-9]{64}$/.test(token),
    "Open the local website to create a demo identity.",
    401,
  );
  const row = (
    await c.query(
      "SELECT u.* FROM demo_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [sessionHash(token)],
    )
  ).rows[0];
  assertDomain(row, "Session expired. Reload the local website.", 401);
  return row as Actor;
}
export async function openSession(c: PoolClient, request: Request) {
  try {
    return { actor: await actorFor(c, request), cookie: null };
  } catch {
    const actor = await one(
      c,
      "SELECT u.* FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.name='Remix Demo' AND u.name='Demo Operator' ORDER BY w.created_at LIMIT 1",
    );
    const token = randomBytes(32).toString("hex");
    await c.query(
      "INSERT INTO demo_sessions(token_hash,user_id) VALUES($1,$2)",
      [sessionHash(token), actor.id],
    );
    return {
      actor: actor as Actor,
      cookie: `remix_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
    };
  }
}
