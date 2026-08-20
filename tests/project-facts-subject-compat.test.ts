import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260820093000_project_facts_subject_compat.sql",
  "utf8"
);

describe("project_facts subject compatibility", () => {
  it("derives the required subject from the AI fact label before insert", () => {
    expect(migration).toContain("before insert or update of subject, value_json, fact_type");
    expect(migration).toContain("new.value_json ->> 'label'");
    expect(migration).toContain("new.fact_type");
  });

  it("preserves an explicit non-empty subject", () => {
    expect(migration).toContain("if nullif(btrim(new.subject), '') is null then");
  });
});
