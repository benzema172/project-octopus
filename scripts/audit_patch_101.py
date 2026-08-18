from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Missing patch target in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected_min=1):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count < expected_min:
        raise SystemExit(f"Expected >= {expected_min} patch targets in {path}, got {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


records = "app/api/company/records/route.ts"
replace_once(records, '''async function assignSourceDocumentToProject(documentId: string, projectId: string | null) {
  if (!projectId) return;
  const supabase = createServiceSupabaseClient();
  await Promise.all([
    supabase.from("documents").update({ project_id: projectId }).eq("id", documentId),
    supabase.from("document_versions").update({ project_id: projectId }).eq("document_id", documentId),
    supabase.from("document_extractions").update({ project_id: projectId }).eq("document_id", documentId),
    supabase.from("document_intakes").update({ proposed_project_id: projectId }).eq("document_id", documentId)
  ]);
}
''', '''async function assignSourceDocumentToProject(workspaceId: string, documentId: string, projectId: string | null, actorId: string) {
  if (!projectId) return;
  const { error } = await createServiceSupabaseClient().rpc("assign_document_to_project_atomic", {
    p_workspace_id: workspaceId,
    p_document_id: documentId,
    p_project_id: projectId,
    p_actor_id: actorId
  });
  if (error) throw new Error(`Nie udało się atomowo przypisać dokumentu do inwestycji: ${error.message}`);
}
''')
replace_all(records, 'await assignSourceDocumentToProject(source.documentId, projectId);', 'await assignSourceDocumentToProject(workspace.id, source.documentId, projectId, user.id);', 2)

replace_once(records, '''    } else if (body.entity === "stock_movement") {
      const warehouseId = await requireOwnedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const stockItemId = await requireOwnedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const targetWarehouseId = p.targetWarehouseId ? await requireOwnedId("warehouses", p.targetWarehouseId, workspace.id, "Magazyn docelowy") : null;
      const { data: movement, error } = await supabase.from("stock_movements").insert({ workspace_id: workspace.id, project_id: projectId, warehouse_id: warehouseId, target_warehouse_id: targetWarehouseId, movement_type: text(p.movementType, "typ ruchu", true), document_number: text(p.documentNumber, "numer dokumentu"), movement_date: date(p.movementDate) ?? new Date().toISOString().slice(0, 10), status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).select("id").single<{ id: string }>();
      if (error || !movement) throw error ?? new Error("Nie utworzono ruchu.");
      const { error: lineError } = await supabase.from("stock_movement_lines").insert({ workspace_id: workspace.id, movement_id: movement.id, stock_item_id: stockItemId, quantity: amount(p.quantity, "ilość", true), unit_cost: amount(p.unitCost, "koszt jednostkowy") || null });
      if (lineError) { await supabase.from("stock_movements").delete().eq("id", movement.id); throw lineError; }
      id = movement.id;
''', '''    } else if (body.entity === "stock_movement") {
      const warehouseId = await requireOwnedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const stockItemId = await requireOwnedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const targetWarehouseId = p.targetWarehouseId ? await requireOwnedId("warehouses", p.targetWarehouseId, workspace.id, "Magazyn docelowy") : null;
      const { data: movement, error } = await supabase.rpc("create_stock_movement_atomic", {
        p_workspace_id: workspace.id,
        p_project_id: projectId,
        p_warehouse_id: warehouseId,
        p_target_warehouse_id: targetWarehouseId,
        p_stock_item_id: stockItemId,
        p_movement_type: text(p.movementType, "typ ruchu", true),
        p_quantity: amount(p.quantity, "ilość", true),
        p_unit_cost: p.unitCost === undefined || p.unitCost === "" ? null : amount(p.unitCost, "koszt jednostkowy"),
        p_document_number: text(p.documentNumber, "numer dokumentu") ?? "",
        p_movement_date: date(p.movementDate) ?? new Date().toISOString().slice(0, 10),
        p_actor_id: user.id
      }).single<{ result_movement_id: string }>();
      if (error || !movement) throw new Error(`Nie udało się atomowo zapisać ruchu magazynowego: ${error?.message ?? "brak danych"}`);
      id = movement.result_movement_id;
''')

replace_once(records, '''    } else if (body.entity === "stock_movement_approve") {
      const movementId = await requireOwnedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const { count } = await supabase.from("stock_movement_lines").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("movement_id", movementId);
      if (!count) throw new Error("Nie można zatwierdzić ruchu bez pozycji.");
      const { error } = await supabase.from("stock_movements").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", movementId).eq("workspace_id", workspace.id);
      if (error) throw error;
      id = movementId;
''', '''    } else if (body.entity === "stock_movement_approve") {
      const movementId = await requireOwnedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const { data: approvedId, error } = await supabase.rpc("approve_stock_movement_atomic", {
        p_workspace_id: workspace.id,
        p_movement_id: movementId,
        p_actor_id: user.id
      });
      if (error) throw new Error(`Nie udało się atomowo zatwierdzić ruchu magazynowego: ${error.message}`);
      id = String(approvedId ?? movementId);
''')

ops = "components/company/company-operations-workspace.tsx"
replace_once(ops, '  const movementValue = (movement: Row) => lines.filter((row) => row.movement_id === movement.id).reduce((sum, row) => sum + Number(row.quantity ?? 0) * Number(row.unit_cost ?? 0), 0);\n', '')

power = "components/company/company-power-tools.tsx"
replace_once(power, 'import { useMemo, useState, useTransition } from "react";', 'import { useState, useTransition } from "react";')
replace_once(power, '  Check, ChevronDown, CircleDollarSign, Download, Gauge, LoaderCircle, PackageCheck, Plus, RefreshCcw,', '  Check, ChevronDown, CircleDollarSign, Download, Gauge, LoaderCircle, PackageCheck, RefreshCcw,')
replace_once(power, '  const aging = useMemo(() => invoiceAging(invoices, referenceDate), [invoices, referenceDate]);', '  const aging = invoiceAging(invoices, referenceDate);')

blueprint = "lib/demo/extended-blueprint.ts"
replace_once(blueprint, 'import { demoId, type DemoBlueprint, type DemoRow } from "./blueprint";', 'import { demoId, type DemoBlueprint } from "./blueprint";')

validator = "scripts/validate-migrations-local.mjs"
replace_once(validator, '  "supabase/migrations/20260818073000_101_company_document_upload_fix.sql"\n];', '  "supabase/migrations/20260818073000_101_company_document_upload_fix.sql",\n  "supabase/migrations/20260818074000_101_stock_and_document_integrity.sql"\n];')
replace_once(validator, '    "get_project_command_center"\n  ];', '    "get_project_command_center",\n    "create_stock_movement_atomic",\n    "approve_stock_movement_atomic",\n    "assign_document_to_project_atomic"\n  ];')
replace_once(validator, 'if (markers.rows.length < 11) throw new Error(`Expected 0.9.1–1.0.1 schema markers, received ${markers.rows.length}.`);', 'if (markers.rows.length < 12) throw new Error(`Expected 0.9.1–1.0.1 schema markers, received ${markers.rows.length}.`);')
replace_once(validator, '''  if (!identityConflictRejected) throw new Error("Company document could be rebound to a project through a later version.");

  const firstBudget''', '''  if (!identityConflictRejected) throw new Error("Company document could be rebound to a project through a later version.");
  await database.query("select public.assign_document_to_project_atomic($1,$2,$3,$4)", [workspaceId, companyDocumentId, projectId, userId]);
  const assignedCompanyDocument = await database.query("select project_id from public.documents where id=$1", [companyDocumentId]);
  const assignedCompanyVersion = await database.query("select project_id from public.document_versions where id=$1", [companyVersionId]);
  if (assignedCompanyDocument.rows[0]?.project_id !== projectId || assignedCompanyVersion.rows[0]?.project_id !== projectId) {
    throw new Error("Atomic document assignment did not update document and version together.");
  }

  const firstBudget''')
replace_once(validator, '''  const beforeTransfer = await database.query("select quantity from public.get_stock_balances($1) where warehouse_id=$2 and stock_item_id=$3", [workspaceId, warehouseA, itemId]);
  if (Number(beforeTransfer.rows[0]?.quantity) !== 10) throw new Error("Full stock ledger failed before MM.");
  await database.query("select * from public.transfer_stock_atomic($1,$2,$3,$4,$5,4,'MM-TEST',current_date,$6)", [workspaceId, projectId, warehouseA, warehouseB, itemId, userId]);
  const balances = await database.query("select warehouse_id,quantity from public.get_stock_balances($1) where stock_item_id=$2 order by warehouse_id", [workspaceId, itemId]);
  const balanceMap = new Map(balances.rows.map((row) => [row.warehouse_id, Number(row.quantity)]));
  if (balanceMap.get(warehouseA) !== 6 || balanceMap.get(warehouseB) !== 4) throw new Error("Atomic stock transfer or full ledger failed.");
''', '''  const beforeTransfer = await database.query("select quantity from public.get_stock_balances($1) where warehouse_id=$2 and stock_item_id=$3", [workspaceId, warehouseA, itemId]);
  if (Number(beforeTransfer.rows[0]?.quantity) !== 10) throw new Error("Full stock ledger failed before MM.");
  let negativeStockRejected = false;
  try {
    await database.query("select * from public.create_stock_movement_atomic($1,$2,$3,null,$4,'RW',99,null,'RW-TOO-MUCH',current_date,$5)", [workspaceId, projectId, warehouseA, itemId, userId]);
  } catch {
    negativeStockRejected = true;
  }
  if (!negativeStockRejected) throw new Error("Manual RW could create negative stock.");
  const manualIssue = await database.query("select * from public.create_stock_movement_atomic($1,$2,$3,null,$4,'RW',2,40,'RW-TEST',current_date,$5)", [workspaceId, projectId, warehouseA, itemId, userId]);
  if (Number(manualIssue.rows[0]?.available_before) !== 10 || Number(manualIssue.rows[0]?.available_after) !== 8) throw new Error("Atomic manual warehouse movement returned invalid balances.");
  await database.query("select * from public.transfer_stock_atomic($1,$2,$3,$4,$5,4,'MM-TEST',current_date,$6)", [workspaceId, projectId, warehouseA, warehouseB, itemId, userId]);
  const balances = await database.query("select warehouse_id,quantity from public.get_stock_balances($1) where stock_item_id=$2 order by warehouse_id", [workspaceId, itemId]);
  const balanceMap = new Map(balances.rows.map((row) => [row.warehouse_id, Number(row.quantity)]));
  if (balanceMap.get(warehouseA) !== 4 || balanceMap.get(warehouseB) !== 4) throw new Error("Atomic stock transfer or full ledger failed.");
  const unsafeDraftId = "00000000-0000-4000-8000-000000000015";
  await database.exec(`
    insert into public.stock_movements(id,workspace_id,project_id,warehouse_id,movement_type,status) values ('${unsafeDraftId}','${workspaceId}','${projectId}','${warehouseA}','WZ','draft');
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity) values ('${workspaceId}','${unsafeDraftId}','${itemId}',50);
  `);
  let unsafeApprovalRejected = false;
  try { await database.query("select public.approve_stock_movement_atomic($1,$2,$3)", [workspaceId, unsafeDraftId, userId]); } catch { unsafeApprovalRejected = true; }
  if (!unsafeApprovalRejected) throw new Error("Draft WZ above stock could be approved.");
''')
replace_once(validator, 'console.log("OK   company-level upload, atomic budget, warehouse ledger, MM, purchase order, search, anomalies and Command Center smoke tests");', 'console.log("OK   company upload/assignment, manual stock integrity, atomic budget, warehouse ledger, MM, purchase order, search, anomalies and Command Center smoke tests");')

print("Audit 1.0.1 patch applied")
