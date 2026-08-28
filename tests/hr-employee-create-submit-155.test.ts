import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry employee create submit", () => {
  const createForm = readFileSync("components/company/hr/hr-employee-create-153.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-employee-create-153.module.css", "utf8");

  it("routes validation through the React submit handler so the button always gives feedback", () => {
    expect(createForm).toContain("onSubmit={submit} noValidate");
    expect(createForm).toContain('querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(\":invalid\")');
    expect(createForm).toContain("Uzupełnij pole");
  });

  it("uses an explicit submit button and keeps errors visible next to the actions", () => {
    expect(createForm).toContain('type="submit" className={styles.primary}');
    expect(createForm).toContain("styles.actionError");
    expect(css).toContain(".actionHint,.actionError");
    expect(css).toContain("margin-right:auto");
  });
});
