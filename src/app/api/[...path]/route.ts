import { z } from "zod";
import { transaction } from "@/lib/server/db";
import {
  actorFor,
  localOnly,
  openSession,
  tokenFrom,
  sessionHash,
} from "@/lib/server/session";
import { execute, one, audit } from "@/lib/server/service";
import { snapshot } from "@/lib/server/snapshot";
import { seedWorkspace } from "@/lib/server/seed";
import { DomainError, role, type Actor } from "@/lib/server/domain";
import { id } from "@/lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "Invalid request fields.",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 400, headers },
    );
  if (error instanceof DomainError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers },
    );
  const code = (error as { code?: string }).code;
  if (
    ["23505", "23514", "P0001", "55P03", "40001", "40P01"].includes(code ?? "")
  )
    return Response.json(
      {
        error:
          "Duplicate submission, invalid transition or conflicting material allocation. Refresh to see the committed state.",
      },
      { status: 409, headers },
    );
  console.error(
    "Domain request failed",
    error instanceof Error ? error.message : "unknown",
  );
  return Response.json(
    {
      error:
        "The operation could not be completed. No partial transaction was saved.",
    },
    { status: 500, headers },
  );
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    localOnly(request);
    const { path } = await params;
    if (path.join("/") !== "snapshot")
      return Response.json({ error: "Not found" }, { status: 404 });
    const session = await transaction((c) => openSession(c, request));
    return Response.json(await snapshot(session.actor), {
      headers: {
        ...headers,
        ...(session.cookie ? { "Set-Cookie": session.cookie } : {}),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    localOnly(request);
    if (Number(request.headers.get("content-length") ?? 0) > 50000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const text = await request.text();
    if (text.length > 50000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { path } = await params;
    const actor = await transaction((c) => actorFor(c, request));
    if (path.join("/") === "session") {
      const input = z.object({ userId: id }).strict().parse(body);
      await transaction(async (c) => {
        const user = await one(
          c,
          "SELECT * FROM users WHERE id=$1 AND workspace_id=$2 AND name IN ('Demo Operator','Consumer Alex','Brand Team')",
          [input.userId, actor.workspace_id],
        );
        await c.query(
          "UPDATE demo_sessions SET user_id=$2 WHERE token_hash=$1",
          [sessionHash(tokenFrom(request)), user.id],
        );
        await audit(c, actor, "demo_role_selected", "user", user.id, {
          role: user.role,
        });
      });
      return Response.json({ ok: true }, { headers });
    }
    if (path.join("/") === "workspace") {
      const input = z.object({ workspaceId: id }).strict().parse(body);
      await transaction(async (c) => {
        const user = await one(
          c,
          "SELECT u.* FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.id=$1 AND u.name=$2 AND (w.name='Remix Demo' OR w.name LIKE 'Demo run %')",
          [input.workspaceId, actor.name],
        );
        await c.query(
          "UPDATE demo_sessions SET user_id=$2 WHERE token_hash=$1",
          [sessionHash(tokenFrom(request)), user.id],
        );
        await audit(
          c,
          user as Actor,
          "demo_workspace_selected",
          "workspace",
          user.workspace_id,
        );
      });
      return Response.json({ ok: true }, { headers });
    }
    if (path.join("/") === "demo-reset") {
      const input = z
        .object({
          scenario: z
            .enum(["standard", "genuine_shortage"])
            .default("standard"),
        })
        .strict()
        .parse(body);
      role(actor);
      const seeded = await transaction(async (c) => {
        const label =
          input.scenario === "genuine_shortage"
            ? " · GENUINE SHORTAGE"
            : "";
        const next = await seedWorkspace(
          c,
          `Demo run ${new Date().toISOString()}${label}`,
          input.scenario,
        );
        await c.query(
          "UPDATE demo_sessions SET user_id=$2 WHERE token_hash=$1",
          [sessionHash(tokenFrom(request)), next.admin.id],
        );
        return next;
      });
      return Response.json({ workspaceId: seeded.workspaceId }, { headers });
    }
    return Response.json(await execute(actor, path, body), { headers });
  } catch (e) {
    return failure(e);
  }
}
