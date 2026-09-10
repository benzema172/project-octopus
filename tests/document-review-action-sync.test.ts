import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("document review action sync", () => {
  it("turns every Document Flow review state into an actionable queue item", () => {
    const page = read("app/workspace/companies/[workspaceId]/documents/page.tsx");
    expect(page).toContain("function documentNeedsReview");
    expect(page).toContain("const queueByDocumentId = new Map");
    expect(page).toContain("status: \"review\"");
    expect(page).toContain("canApprove: domainAccessPolicyAllows");
    expect(page).toContain("reviewItems={documentQueueItems}");
  });

  it("shows the decision controls next to the selected review document", () => {
    const archive = read("components/documents/document-central-archive.tsx");
    expect(archive).toContain("const selectedReviewItem");
    expect(archive).toContain("Decyzja wymagana");
    expect(archive).toContain("Podejmij decyzję ↓");
    expect(archive).toContain("items={[selectedReviewItem]}");
    expect(archive).toContain("currentUserId={currentUserId}");
  });
});
