import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Fleet vehicles compact registry layout", () => {
  it("keeps vehicle creation compact and the registry full width", () => {
    const source = read("components/company/operations/fleet-operations.tsx");
    expect(source).toContain('className="fleet-vehicles-polish"');
    expect(source).toContain('button:nth-child(2)[class*="tabActive"]');
    expect(source).toContain('article:has(> div + details[class*="formCard"])');
    expect(source).toContain('width: max-content');
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) !important');
    expect(source).toContain('article:has([class*="tableHead"])');
    expect(source).toContain('position: sticky');
    expect(source).toContain('background: #222047 !important');
  });

  it("keeps Fleet KPI only on dashboard and removes AI waiting/service navigation", () => {
    const source = read("components/company/operations/fleet-operations.tsx");
    expect(source).toContain('button:nth-child(3)');
    expect(source).toContain('button:nth-child(5)');
    expect(source).toContain('button:not(:first-child)[class*="tabActive"]');
    expect(source).toContain('> div[class*="kpis"] > :nth-child(3)');
    expect(source).toContain('> div[class*="kpis"] > :nth-child(4)');
    expect(source).toContain('div[class*="actionRow"] > :first-child');
  });

  it("uses the existing fleet search as the vehicle list filter", () => {
    const workspace = read("components/company/fleet-workspace-300.tsx");
    expect(workspace).toContain('placeholder="Szukaj po rejestracji, VIN, marce lub modelu…"');
    expect(workspace).toContain('router.push(`/workspace/companies/${workspaceId}/fleet?page=1');
    expect(workspace).toContain('setTab("vehicles")');
  });
});
