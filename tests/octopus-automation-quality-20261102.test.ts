import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {mayApplyAccountingDraftSuggestion} from "../lib/finance/accounting-suggestion-evidence";
const read=(p:string)=>readFileSync(p,"utf8");
const sql=read("supabase/migrations/20261102125000_automation_quality_session_and_purchase_evidence.sql");
const report=read("app/api/documents/import-session/route.ts");
const panel=read("components/documents/document-upload.tsx");
const approval=read("app/api/documents/import-group-approve/route.ts");
const accounting=read("lib/ai/accounting-copilot.ts");
const autopilot=read("lib/ai/document-autopilot.ts");

describe("Project Octopus grouped automation and quality",()=>{
  it("closes terminal import sessions from asynchronous DB stage updates",()=>{
    expect(sql).toContain("trg_octopus_import_stage_finish_20261102");
    expect(sql).toContain("trg_octopus_import_ai_finish_20261102");
    expect(sql).toContain("coalesce(st.stage_count,0)<6");
    expect(sql).toContain("when v_counts.review>0 then 'review'");
    expect(sql).toContain("when v_counts.failed>0 then 'error'");
    expect(sql).toContain("where upload_completed_at is not null and status='processing'");
  });
  it("only reports actual destination writes and grouped source evidence",()=>{
    expect(sql).toContain("get_import_automation_quality_20261102");
    expect(sql).toContain("get_import_purchase_evidence_20261102");
    expect(sql).toContain("p.project_id");
    expect(sql).toContain("p.source_quote");
    expect(sql).toContain("avgJobElapsedSeconds");
    expect(sql).toContain("accountingMemoryUses");
    expect(sql).toContain("supplier");
    expect(report).toContain("automationQuality: qualityResult.data");
    expect(report).toContain("purchaseEvidence: purchasesResult.data");
    expect(panel).toContain("Do zatwierdzenia:");
    expect(panel).toContain("batchSummary.decisionOverview.consolidatedLines");
  });
  it("keeps financially binding operations behind authorised human action",()=>{
    expect(approval).toContain("body.confirm!==true");
    expect(approval).toContain("level:\"approve\"");
    expect(approval).toContain("ids.length>20");
    expect(approval).toContain("document_import_session_items");
    expect(approval).toContain('p_action:"approve"');
    expect(approval).toContain('review_status","approved"');
    expect(approval).toContain("Number(r.confidence??0)<0.90");
    expect(panel).toContain("window.confirm(");
    expect(sql).toContain("suggestion_only_no_stock_or_accounting_posting");
  });
  it("calibrates autonomy without increasing model self-reported confidence",()=>{
    expect(autopilot).toContain("Math.min(Number(classificationConfidence),await calibratedConfidence(");
  });
});
describe("Source-grounded accounting draft suggestions",()=>{
 const base={
  invoiceNumber:"FV/10/2026",counterpartyTaxId:"1234567890",
  lineDescription:"Materiały instalacyjne",lineId:"line-id",
  accountIsActive:true,confidence:0.99,risk:0.04,threshold:0.97,
  tax:"KUP",vat:100,manualOverride:false,reasons:["Opis na fakturze potwierdza zakup materiałów"]
 };
 it("allows evidence-backed draft proposals, but not journal approval",()=>{
    expect(mayApplyAccountingDraftSuggestion(base)).toBe(true);
    expect(accounting).toContain("mayApplyAccountingDraftSuggestion(");
    expect(accounting).toContain('status: "active"');
 });
 it("rejects vague AI votes, missing VAT and missing invoice evidence",()=>{
    expect(mayApplyAccountingDraftSuggestion({...base,reasons:[]})).toBe(false);
    expect(mayApplyAccountingDraftSuggestion({...base,vat:null})).toBe(false);
    expect(mayApplyAccountingDraftSuggestion({...base,counterpartyTaxId:""})).toBe(false);
    expect(mayApplyAccountingDraftSuggestion({...base,lineDescription:""})).toBe(false);
    expect(mayApplyAccountingDraftSuggestion({...base,manualOverride:true})).toBe(false);
    expect(mayApplyAccountingDraftSuggestion({...base,confidence:0.88})).toBe(false);
    expect(mayApplyAccountingDraftSuggestion({...base,risk:0.9})).toBe(false);
 });
});
