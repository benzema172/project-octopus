import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUEST_DEMO_DATASET_VERSION } from "../lib/demo/guest-constants";

const read = (path: string) => readFileSync(path, "utf8");

describe("versioned guest demo seed", () => {
  it("uses an explicit dataset version marker", () => {
    expect(GUEST_DEMO_DATASET_VERSION).toBe("2026-08-19-final-audit-v1");
  });

  it("reuses a healthy current dataset instead of reseeding on every login", () => {
    const source = read("lib/demo/guest-server.ts");
    const matchingVersion = source.indexOf("existingVersion === GUEST_DEMO_DATASET_VERSION");
    const legacyAdoption = source.indexOf("legacyGuestDatasetLooksComplete");
    const seed = source.lastIndexOf("seedGuestDemoData(guest.id)");

    expect(matchingVersion).toBeGreaterThan(0);
    expect(legacyAdoption).toBeGreaterThan(0);
    expect(seed).toBeGreaterThan(legacyAdoption);
    expect(source).toContain("demo_dataset_version: GUEST_DEMO_DATASET_VERSION");
    expect(source).toContain("counts: {}");
  });

  it("only adopts an unversioned legacy dataset and forces deliberate future version refreshes", () => {
    const source = read("lib/demo/guest-server.ts");
    expect(source).toContain("if (!existingVersion && await legacyGuestDatasetLooksComplete(guest.id))");
    expect(source).toContain("await markGuestDatasetVersion(guest.id, guest.user_metadata)");
  });
});
