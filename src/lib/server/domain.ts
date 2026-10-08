export type Role = "brand_user" | "consumer" | "admin/demo";
export type Actor = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  name: string;
  role: Role;
};
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function assertDomain(
  test: unknown,
  message: string,
  status = 409,
): asserts test {
  if (!test) throw new DomainError(message, status);
}
export function role(actor: Actor, ...roles: Role[]) {
  assertDomain(
    actor.role === "admin/demo" || roles.includes(actor.role),
    "This operation is not available for your role.",
    403,
  );
}
export function owns(actor: Actor, ownerId: string) {
  assertDomain(
    actor.role === "admin/demo" || actor.id === ownerId,
    "This record belongs to another consumer.",
    403,
  );
}
export function brandOwns(actor: Actor, brandId: string) {
  role(actor, "brand_user");
  assertDomain(
    actor.role === "admin/demo" || actor.brand_id === brandId,
    "This inventory belongs to another brand.",
    403,
  );
}
export { materialCompatibility as compatibility } from "../material-match-engine";
export const roundKg = (n: number) => Math.round(n * 1000) / 1000;
