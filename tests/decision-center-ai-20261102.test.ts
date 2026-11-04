import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const read=(file:string)=>readFileSync(file,"utf8");
const sql=read("supabase/migrations/20261102161500_decision_center_financial_material_plans.sql");
const api=read("app/api/documents/decision-center/route.ts");
const ui=read("components/documents/document-decision-center.tsx");
const archive=read("components/documents/document-central-archive.tsx");
describe("Octopus AI decision center",()=>{
 it("accepts actual RFC 4122 workspace and source document UUIDs",()=>{
  const pattern=api.match(/const uuid=\/(.+)\/i;/)?.[1];
  expect(pattern).toBeDefined();
  const uuid=new RegExp(pattern!,"i");
  expect(uuid.test("2b01548c-f892-5fc9-9d30-662e90ffc433")).toBe(true);
  expect(uuid.test("e2d88bf5-8570-4885-95c2-a5ba70cb5bec")).toBe(true);
  expect(uuid.test("not-a-valid-id")).toBe(false);
 });
 it("replaces redundant purchase invoice category approvals with one decision",()=>{
  expect(archive).toContain("<DocumentDecisionCenter");
  expect(archive).toContain('selectedModule==="finance" || selectedModule==="warehouse"');
  expect(archive).toContain("AI rozpoznaje dokumenty");
  expect(archive).toContain("Informacje techniczne, OCR i raport routingu AI");
  expect(ui).toContain("Typ dokumentu jest rozpoznany automatycznie.");
  expect(ui).toContain("Zapisz i następny dokument");
  expect(ui).toContain("Zastosuj do wszystkich");
  expect(ui).toContain("Podziel");
 });
 it("secures both reading and decisions to the document and workspace",()=>{
  expect(api).toContain('getRequestUser(request)');
  expect(api).toContain('getWorkspaceForUser(user,workspaceId)');
  expect(api).toContain('.eq("id",documentId).eq("workspace_id",workspace.id)');
  expect(api).toContain('hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain,level:write?"write":"read"');
  expect(api).toContain('domain:"finance",level:"write"');
  expect(api).toContain('domain:"warehouse",level:"write"');
  expect(api).toContain('domain:"investments",level:"write",projectId');
 });
 it("never approves accounting or consumes inventory from a source invoice",()=>{
  expect(sql).toContain("notStockMovement");
  expect(sql).toContain("notConsumption");
  expect(sql).toContain("apply_decision_center_invoice_plan_20261102");
  expect(sql).toContain("set_invoice_line_scope_and_rebuild_atomic");
  expect(sql).toContain("apply_decision_center_warehouse_intent_20261102");
  expect(sql).not.toMatch(/update\s+public\.stock_movements/i);
  expect(sql).not.toMatch(/update\s+public\.accounting_entries/i);
 });
 it("validates net totals, quantities, supplier invoices and duplicate split targets",()=>{
  expect(sql).toContain("v_inv.direction<>'purchase'");
  expect(sql).toContain("distinct (r->>'lineId')");
  expect(sql).toContain("Rozbicie wartości nie sumuje");
  expect(sql).toContain("Rozbicie ilości nie sumuje");
  expect(sql).toContain("Nie powielaj tego samego celu");
  expect(sql).toContain("p_actor_id");
  expect(sql).toContain("allocation_source='manual'");
  expect(api).toContain('"source_conflict","duplicate_candidate"');
 });
 it("only persists destinations and never claims actual material consumption",()=>{
  expect(sql).toContain("document_allocation_targets_20261102");
  expect(sql).toContain("enable row level security");
  expect(sql).toContain("to service_role");
  expect(sql).toContain("'planned'");
  expect(sql).toContain("fr.review_type='project_assignment'");
  expect(ui).toContain("Koszt ogólny");
  expect(ui).toContain("Magazyn centralny");
 });
 it("shows the real source preview under the user's existing access controls",()=>{
  expect(ui).toContain('"/api/storage/download-url"');
  expect(ui).toContain('disposition:"inline"');
  expect(ui).toContain("<DocumentOpenLink");
  expect(ui).not.toContain("<iframe");
  expect(ui).toContain("Oryginał faktury");
  expect(ui).toContain("Gdzie przypisać");
  expect(ui).toContain("lineAdvanced");
 });
});