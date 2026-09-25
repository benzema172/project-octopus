import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("Accounting Copilot 7.0",()=>{
  const migration=read("supabase/migrations/20260925092000_accounting_ai_700.sql");
  const accounting=read("components/company/accounting-center.tsx");
  const copilot=read("lib/ai/accounting-copilot.ts");
  const importRoute=read("app/api/company/accounting/plan-import/route.ts");
  const exportRoute=read("app/api/company/accounting/export/route.ts");
  const brain=read("app/api/brain/process/route.ts");
  const finance=read("components/company/finance-control-tower.tsx");

  it("adds a professional accounting domain with tax, VAT and JPK controls",()=>{
    expect(migration).toContain("jpk_s12_1");
    expect(migration).toContain("tax_default");
    expect(migration).toContain("vat_deduction_pct");
    expect(migration).toContain("accounting_decision_memory");
    expect(migration).toContain("accounting_ai_suggestions");
    expect(migration).toContain("accounting_export_profiles");
    expect(migration).toContain("approve_accounting_entry_700");
    expect(migration).toContain("require_jpk_markers=true");
  });

  it("keeps AI subordinate to accountant rules and human approval",()=>{
    expect(copilot).toContain("hardRule");
    expect(copilot).toContain("human_memory");
    expect(copilot).toContain("allowedAccounts");
    expect(copilot).toContain("taxTreatment=review");
    expect(copilot).toContain("ai_auto_apply_threshold");
    expect(copilot).not.toContain("allow_ai_auto_approval:true");
    expect(accounting).toContain("AI proponuje · człowiek zatwierdza");
    expect(accounting).toContain("Zatwierdź dekret");
  });

  it("imports the accountant chart of accounts from CSV or Excel",()=>{
    expect(importRoute).toContain('["csv","xlsx","xls"]');
    expect(importRoute).toContain("jpk_s12_1");
    expect(importRoute).toContain("accounting_plan_imports");
    expect(importRoute).toContain("accounting_plan_import");
  });

  it("exports only approved accounting entries through adapter profiles",()=>{
    expect(exportRoute).toContain('.eq("status","approved")');
    expect(exportRoute).toContain("generic_csv");
    expect(exportRoute).toContain("octopus_json");
    expect(exportRoute).toContain("custom_csv");
    expect(exportRoute).toContain("accounting.batch_exported_700");
  });

  it("runs accounting automatically after invoice intake and exposes Księgowość in Finance",()=>{
    expect(brain).toContain("runAccountingCopilotForDocument");
    expect(brain).toContain("accounting = checks.accounting");
    expect(finance).toContain('["accounting", "Księgowość"]');
  });
});
