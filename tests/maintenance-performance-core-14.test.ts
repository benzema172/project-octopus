import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Maintenance & Performance Core 14", () => {
  it("removes legacy company-operation type augmentation", () => {
    expect(existsSync("types/company-operations-legacy.d.ts")).toBe(false);
  });

  it("keeps only main enabled for Git production deployments", () => {
    const vercel = read("vercel.json");
    expect(vercel).toContain('"main": true');
    expect(vercel).not.toContain("release/project-octopus-1.2.0");
  });

  it("uses the canonical malware scanner workflow name", () => {
    expect(existsSync(".github/workflows/deploy-malware-scanner.yml")).toBe(true);
    expect(existsSync(".github/workflows/deploy-malware-scanner-temporary.yml")).toBe(false);
  });

  it("retains Fleet 4.0 as an intentional dormant capability rather than deleting future Connected Fleet work", () => {
    expect(existsSync("components/company/fleet-workspace-400.tsx")).toBe(true);
    expect(existsSync("lib/data/fleet-connected-400.ts")).toBe(true);
    const operations = read("components/company/operations/fleet-operations.tsx");
    expect(operations).not.toContain("FleetWorkspace400");
  });
});
