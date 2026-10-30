import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const finalization=readFileSync("lib/finance/document-invoice-finalization.ts","utf8");
const readiness=readFileSync("lib/finance/invoice-intake-readiness.ts","utf8");

describe("Wrzutnia bulk financial review completeness",()=>{
 it("does not stop after the twentieth Business Inbox AI decision",()=>{
   expect(finalization).toContain('.in("business_inbox_item_id", inboxIds)');
   expect(finalization).toContain('.limit(1000)');
   expect(finalization).not.toContain('.limit(20)');
   expect(finalization).toContain('if ((data ?? []).length >= 1000)');
 });
 it("does not silently discard invoice records beyond fifty",()=>{
   expect(finalization).toContain('if ((inboxData ?? []).length >= 501)');
   expect(readiness).toContain('if ((inboxData ?? []).length >= 501)');
   expect(readiness).not.toContain('.limit(50)');
 });
 it("does not auto-assign fuel if invoice OCR quality is unresolved",()=>{
   expect(finalization).toContain("invoiceReadiness.every((invoice) => !invoice.requiresReview)");
   expect(finalization).toContain("financeAi.requiresHuman === 0");
   expect(finalization).toContain("if (safeFuelAutobooking)");
 });
 it("stops reconciliation when a response reaches the Supabase row limit",()=>{
   expect(readiness).toContain('(lineResult.data ?? []).length >= 1000');
   expect(readiness).toContain('(reviewResult.data ?? []).length >= 1000');
   expect(readiness).toContain('ponowienia weryfikacji');
 });
});
