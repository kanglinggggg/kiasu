import test from "node:test";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3000";
async function client() {
  const r = await fetch(`${base}/api/snapshot`),
    cookie = r.headers.get("set-cookie")?.split(";")[0];
  assert.equal(r.status, 200);
  assert.ok(cookie);
  return async (path, body) => {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
}
test("independent cookie sessions share committed state and reject duplicate HTTP mutations", async () => {
  const a = await client(),
    b = await client();
  const reset = await a("demo-reset", {});
  assert.equal(reset.status, 200);
  assert.equal(
    (await b("workspace", { workspaceId: reset.body.workspaceId })).status,
    200,
  );
  const s = (await a("snapshot")).body,
    d = s.drops.find((d) => d.code === "DROP024");
  const item = await a("consumer-items", {
    type: "Denim Jeans",
    material: "Cotton Denim",
    condition: "Damaged / reusable panels",
    usage: "No longer used",
    ageMonths: 24,
  });
  assert.equal(item.status, 200);
  const ret = await a("returns", {
    itemId: item.body.id,
    dropId: d.id,
    collectionPointId: s.points[0].id,
  });
  assert.equal(ret.status, 200);
  const duplicateReserve = await b("returns", {
    itemId: item.body.id,
    dropId: d.id,
    collectionPointId: s.points[0].id,
  });
  assert.equal(duplicateReserve.status, 409);
  assert.equal(
    (await b("snapshot")).body.drops.find((x) => x.id === d.id).allocated_kg,
    67.2,
  );
  const received = await Promise.all([
    a(`returns/${ret.body.id}/receive`, {}),
    b(`returns/${ret.body.id}/receive`, {}),
  ]);
  assert.deepEqual(received.map((x) => x.status).sort(), [200, 409]);
  const inspected = await Promise.all([
    a(`returns/${ret.body.id}/simulate-inspection`, {}),
    b(`returns/${ret.body.id}/simulate-inspection`, {}),
  ]);
  assert.deepEqual(inspected.map((x) => x.status).sort(), [200, 409]);
  const verified = (await b("snapshot")).body;
  assert.equal(verified.balance, 180);
  const source = verified.returns.find((x) => x.id === ret.body.id).source_id;
  assert.equal(
    (
      await a(`drops/${d.id}/allocate-material`, {
        sourceId: source,
        requirementId: d.requirements[0].id,
        kg: 0.8,
        requestKey: crypto.randomUUID(),
      })
    ).status,
    200,
  );
  const orders = await Promise.all([
    a(`drops/${d.id}/preorder`, {}),
    b(`drops/${d.id}/preorder`, {}),
  ]);
  assert.deepEqual(orders.map((x) => x.status).sort(), [200, 409]);
  const ready = (await b("snapshot")).body.drops.find((x) => x.id === d.id);
  assert.equal(ready.orders, 42);
  assert.equal(ready.allocated_kg, 68);
  assert.equal(ready.gross_sales, 2058);
  assert.equal((await b(`drops/${d.id}/unlock`, {})).status, 200);
  assert.equal((await a("snapshot")).body.production[0].confirmed_units, 42);
  const consumer = s.users.find((u) => u.role === "consumer");
  assert.equal((await b("session", { userId: consumer.id })).status, 200);
  assert.equal((await b(`drops/${d.id}/unlock`, {})).status, 403);
  assert.equal(
    (await b("consumer-items", { verified_material_kg: 999 })).status,
    400,
  );
  const foreign = await fetch(`${base}/api/snapshot`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(foreign.status, 403);
});
