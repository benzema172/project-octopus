import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/workspace/projects/[projectId]/documentation/page.tsx", "utf8");

describe("Documents tab automation", () => {
  it("does not make AI proposal review the primary document-routing workflow", () => {
    expect(page).not.toContain("ProjectAiReviewCenter");
    expect(page).not.toContain("getProjectAiProposalReview");
  });
});
