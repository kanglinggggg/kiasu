"use client";
import { Quality } from "@/lib/material-quality";
export function QualityFields({
  value,
  onChange,
}: {
  value: Quality;
  onChange: (value: Quality) => void;
}) {
  const fields = {
    quality_grade: ["A", "B", "C", "fibre_only"],
    composition: ["cotton_rich", "cotton_blend", "synthetic", "unknown"],
    colour_family: ["blue", "dark", "light", "mixed", "unknown"],
    fabric_weight: ["light", "medium", "heavy", "unknown"],
    panel_grade: ["large", "small", "fibre_only"],
    contamination_status: ["clean", "requires_cleaning", "contaminated"],
  } as const;
  return (
    <details>
      <summary>Human inspection · quality attributes</summary>
      <p className="fine-print">
        Prototype default: grade B, clean cotton-rich denim with large panels.
        Confirm or correct before verification. AI confidence is not
        verification.
      </p>
      <div className="form-grid">
        {Object.entries(fields).map(([field, options]) => (
          <label key={field}>
            {field.replaceAll("_", " ")}
            <select
              value={value[field as keyof Quality]}
              onChange={(e) => onChange({ ...value, [field]: e.target.value })}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}
