import { z } from "zod";
export const qualityInput = z
  .object({
    quality_grade: z.enum(["A", "B", "C", "fibre_only"]).default("B"),
    composition: z
      .enum(["cotton_rich", "cotton_blend", "synthetic", "unknown"])
      .default("cotton_rich"),
    colour_family: z
      .enum(["blue", "dark", "light", "mixed", "unknown"])
      .default("blue"),
    fabric_weight: z
      .enum(["light", "medium", "heavy", "unknown"])
      .default("medium"),
    panel_grade: z.enum(["large", "small", "fibre_only"]).default("large"),
    contamination_status: z
      .enum(["clean", "requires_cleaning", "contaminated"])
      .default("clean"),
  })
  .strict();
export type Quality = z.infer<typeof qualityInput>;
export function qualityCompatible(
  source: Pick<
    Quality,
    "quality_grade" | "panel_grade" | "contamination_status" | "composition"
  >,
  grades: readonly string[],
) {
  return (
    grades.includes(source.quality_grade) &&
    source.panel_grade !== "fibre_only" &&
    source.contamination_status === "clean" &&
    ["cotton_rich", "cotton_blend"].includes(source.composition)
  );
}
export const defaultQuality = qualityInput.parse({});
