import { qualityInput } from "../material-quality";
import { z } from "zod";
import { materials, conditions } from "../mock-data";
import {
  itemTypes,
  itemMaterials,
  itemConditions,
  itemUsages,
} from "../return-engine";
export const id = z.string().uuid();
export const kg = z.number().finite().min(0).max(1000000).multipleOf(0.001);
export const empty = z.object({}).strict();
export const batchInput = z
  .object({
    product: z.string().trim().min(1).max(80),
    quantity: z.number().int().min(1).max(100000),
    material: z.enum(materials as ["Cotton Denim", "Cotton Blend Denim"]),
    condition: z.enum(
      conditions as [
        (typeof conditions)[number],
        ...(typeof conditions)[number][],
      ],
    ),
    price: z.number().finite().min(1).max(100000),
    weight: kg.nullable(),
  })
  .strict();
export const itemInput = z
  .object({
    type: z.enum(itemTypes),
    material: z.enum(itemMaterials),
    condition: z.enum(itemConditions),
    usage: z.enum(itemUsages),
    ageMonths: z.number().int().min(0).max(1200),
  })
  .strict();
export const returnInput = z
  .object({ itemId: id, dropId: id, collectionPointId: id })
  .strict();
export const inspectInput = z
  .object({
    quality: qualityInput.optional(),
    result: z.enum(["accepted", "partially_accepted", "rejected"]),
    kg,
    material: z.enum([
      "Cotton Denim",
      "Cotton Blend Denim",
      "Cotton",
      "Polyester",
      "Unknown",
    ]),
    condition: z.enum(itemConditions),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
export const allocationInput = z
  .object({
    sourceId: id,
    requirementId: id,
    kg: kg.refine((n) => n > 0),
    requestKey: z.string().uuid(),
  })
  .strict();
export const productionInput = z
  .object({
    dropId: id,
    units: z.number().int().positive().max(100000).optional(),
  })
  .strict();
export const routeInput = z
  .object({
    route: z.enum([
      "Resell / Clearance",
      "Repair + Resell",
      "Remix",
      "Recycle",
    ]),
  })
  .strict();
export const verifyBatchInput = z
  .object({
    quality: qualityInput.optional(),
    kg,
    material: z.enum(["Cotton Denim", "Cotton Blend Denim"]),
    note: z.string().min(3).max(1000),
  })
  .strict();
export const conceptsInput = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export const createDropInput = z.object({ conceptId: id }).strict();
export const approveConceptInput = z
  .object({
    makerName: z.string().trim().min(3).max(120),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

export const preorderInput = z
  .object({ status: z.enum(["pending", "confirmed"]).default("confirmed") })
  .strict();

export const simulatedInspectionInput = z
  .object({ quality: qualityInput.optional() })
  .strict();
