import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseMigration = readFileSync("supabase/migrations/20260811130000_project_octopus_mvp.sql", "utf8");
const foundationFix = readFileSync(
  "supabase/migrations/20260812100000_project_octopus_foundation_fix.sql",
  "utf8"
);

describe("Supabase migration contract", () => {
  it("uses the project profile columns expected by the application", () => {
    expect(baseMigration).toContain("value_text text");
    expect(baseMigration).toContain("value_json jsonb");
    expect(baseMigration).not.toContain("title text not null,\n  value text");
  });

  it("installs the atomic upload function and schema marker", () => {
    expect(foundationFix).toContain("function public.complete_document_upload");
    expect(foundationFix).toContain("20260812_foundation_fix");
    expect(foundationFix).toContain("pg_advisory_xact_lock");
  });

  it("does not expose global AI runs to every authenticated user", () => {
    expect(foundationFix).toContain("project_id is null and created_by = auth.uid()");
  });
});
