import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(p:string)=>readFileSync(p,"utf8");

describe("AI control center without duplicate document archive",()=>{
 it("shows concise automation health and directs invoices to document review",()=>{
  const page=read("app/workspace/companies/[workspaceId]/ai-inbox/page.tsx");
  expect(page).toContain("Centrum kontroli AI");
  expect(page).toContain('data-ai-control-center="1"');
  expect(page).toContain("co-ai-control-stats");
  expect(page).toContain("<AiInbox controlCenter");
  expect(page).toContain("Dokumenty do weryfikacji");
  expect(page).not.toContain("document-principles");
  expect(page).not.toContain("co-settings-cards");
 });
 it("keeps completed records hidden until history is expanded",()=>{
  const inbox=read("components/brain/ai-inbox.tsx");
  expect(inbox).toContain("controlItems");
  expect(inbox).toContain('item.status !== "ready" && item.status !== "rejected"');
  expect(inbox).toContain('<details className="ai-control-history">');
  expect(inbox).toContain("historyItems.map");
  expect(inbox).toContain("onClick={() => retry(item)}");
 });
 it("avoids duplicating invoice review forms and retains other decision actions",()=>{
  const inbox=read("components/brain/ai-inbox.tsx");
  expect(inbox).toContain("Otwórz weryfikację faktury");
  expect(inbox).toContain('documents?tab=review');
  expect(inbox).toContain('!(controlCenter && normalizeDocumentCategory(item.category) === "invoice")');
  expect(inbox).toContain('item.entityType === "document" && item.status === "review"');
  expect(inbox).toContain('item.status === "review" && canApprove');
 });
});
