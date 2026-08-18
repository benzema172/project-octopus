import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "supabase/migrations/20260811130000_project_octopus_mvp.sql",
  "supabase/migrations/20260812100000_project_octopus_foundation_fix.sql",
  "supabase/migrations/20260812120000_company_workspace_shell.sql",
  "supabase/migrations/20260814090000_octopus_operating_system.sql",
  "supabase/migrations/20260814130000_octopus_execution_layer.sql",
  "supabase/migrations/20260814170000_atomic_estimate_approval.sql",
  "supabase/migrations/20260814180000_domain_access_hardening.sql",
  "supabase/migrations/20260817210000_091_reliability_core.sql",
  "supabase/migrations/20260817215000_091_boq_project_scope.sql",
  "supabase/migrations/20260817220000_092_performance_search.sql",
  "supabase/migrations/20260817230000_094_cost_material_graph.sql",
  "supabase/migrations/20260817231000_094_purchase_order_workflow.sql",
  "supabase/migrations/20260817240000_095_ai_quality.sql",
  "supabase/migrations/20260817241000_095_analysis_retry_capture.sql",
  "supabase/migrations/20260817250000_100_command_center.sql",
  "supabase/migrations/20260817250500_100_boq_scope.sql",
  "supabase/migrations/20260817251000_100_command_center_nullsafe.sql",
  "supabase/migrations/20260818073000_101_company_document_upload_fix.sql",
  "supabase/migrations/20260818074000_101_stock_and_document_integrity.sql"
];

function withoutPgcrypto(sql) {
  return sql.replace("create extension if not exists pgcrypto;", "-- pgcrypto is built into Supabase; PGlite uses built-ins in CI.");
}

async function prepareDatabase(database) {
  await database.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
  `);
}

const database = new PGlite();
try {
  await prepareDatabase(database);
  for (const migration of migrations) {
    if (migration.endsWith("20260814090000_octopus_operating_system.sql")) {
      await database.exec(`
        create table public.progress_entries (
          id uuid primary key default gen_random_uuid(),
          project_id uuid references public.projects(id),
          progress_percent numeric,
          created_at timestamptz not null default now()
        );
        create table public.generated_documents (
          id uuid primary key default gen_random_uuid(),
          file_name text,
          created_at timestamptz not null default now()
        );
      `);
    }
    await database.exec(withoutPgcrypto(await readFile(migration, "utf8")));
    console.log(`OK   ${migration}`);
  }

  const expectedFunctions = [
    "complete_document_upload",
    "claim_next_processing_job",
    "approve_estimate_import_atomic",
    "create_progress_entry_atomic",
    "create_budget_version_atomic",
    "save_project_profile_atomic",
    "reassign_invoice_atomic",
    "issue_reservation_atomic",
    "transfer_stock_atomic",
    "record_meter_reading_atomic",
    "get_stock_balances",
    "search_workspace_entities",
    "get_project_cost_graph",
    "create_purchase_order_atomic",
    "get_ai_quality_metrics",
    "refresh_project_anomalies",
    "get_project_command_center",
    "create_stock_movement_atomic",
    "approve_stock_movement_atomic",
    "assign_document_to_project_atomic"
  ];
  for (const name of expectedFunctions) {
    const result = await database.query("select count(*)::integer count from pg_proc where pronamespace='public'::regnamespace and proname=$1", [name]);
    if (result.rows[0]?.count < 1) throw new Error(`Missing database function: ${name}`);
  }

  const markers = await database.query("select version from public.app_schema_versions where version like '20260817_%' or version like '20260818_%' order by version");
  if (markers.rows.length < 12) throw new Error(`Expected 0.9.1–1.0.1 schema markers, received ${markers.rows.length}.`);

  const userId = "00000000-0000-4000-8000-000000000001";
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const projectId = "00000000-0000-4000-8000-000000000003";
  const boqId = "00000000-0000-4000-8000-000000000004";
  await database.exec(`
    insert into auth.users(id) values ('${userId}');
    insert into public.workspaces(id,name,owner_id) values ('${workspaceId}','Octopus 1.0 test','${userId}');
    insert into public.workspace_members(workspace_id,user_id,role) values ('${workspaceId}','${userId}','owner');
    insert into public.projects(id,workspace_id,name,created_by) values ('${projectId}','${workspaceId}','Test 1.0','${userId}');
    insert into public.project_facts(project_id,fact_type,value_text,value_json,confidence,status)
      values ('${projectId}','project_profile','Test 1.0','{"projectName":"Test 1.0","status":"active","contractValue":"100000"}'::jsonb,1,'approved');
    insert into public.boq_items(id,project_id,item_number,description,quantity,unit,unit_price,total_price)
      values ('${boqId}','${projectId}','1.1','Rura testowa DN110',10,'m',40,400);
  `);

  const companyDocumentId = "00000000-0000-4000-8000-000000000005";
  const companyVersionId = "00000000-0000-4000-8000-000000000006";
  const companyUpload = await database.query(
    "select * from public.complete_document_upload($1,$2,$3,null,'instrukcja.pdf','general','application/pdf',128,'test','workspaces/test/company/instrukcja.pdf','etag',null,$4,now())",
    [companyDocumentId, companyVersionId, workspaceId, userId]
  );
  if (companyUpload.rows[0]?.version_number !== 1) throw new Error("Company-level document upload did not create version 1.");
  const companyDocument = await database.query("select project_id,current_version_id from public.documents where id=$1", [companyDocumentId]);
  if (companyDocument.rows[0]?.project_id !== null || companyDocument.rows[0]?.current_version_id !== companyVersionId) {
    throw new Error("Company-level document was not finalized without a project.");
  }
  let identityConflictRejected = false;
  try {
    await database.query(
      "select * from public.complete_document_upload($1,$2,$3,$4,'instrukcja-v2.pdf','general','application/pdf',128,'test','workspaces/test/projects/mismatch.pdf','etag2',null,$5,now())",
      [companyDocumentId, "00000000-0000-4000-8000-000000000007", workspaceId, projectId, userId]
    );
  } catch {
    identityConflictRejected = true;
  }
  if (!identityConflictRejected) throw new Error("Company document could be rebound to a project through a later version.");
  await database.query("select public.assign_document_to_project_atomic($1,$2,$3,$4)", [workspaceId, companyDocumentId, projectId, userId]);
  const assignedCompanyDocument = await database.query("select project_id from public.documents where id=$1", [companyDocumentId]);
  const assignedCompanyVersion = await database.query("select project_id from public.document_versions where id=$1", [companyVersionId]);
  if (assignedCompanyDocument.rows[0]?.project_id !== projectId || assignedCompanyVersion.rows[0]?.project_id !== projectId) {
    throw new Error("Atomic document assignment did not update document and version together.");
  }

  const firstBudget = await database.query("select * from public.create_budget_version_atomic($1,$2,'Budżet',100000,70000,$3)", [workspaceId, projectId, userId]);
  const secondBudget = await database.query("select * from public.create_budget_version_atomic($1,$2,'Budżet korekta',100000,75000,$3)", [workspaceId, projectId, userId]);
  if (firstBudget.rows[0]?.version_number !== 1 || secondBudget.rows[0]?.version_number !== 2) throw new Error("Atomic budget versioning failed.");

  const warehouseA = "00000000-0000-4000-8000-000000000011";
  const warehouseB = "00000000-0000-4000-8000-000000000012";
  const itemId = "00000000-0000-4000-8000-000000000013";
  const movementId = "00000000-0000-4000-8000-000000000014";
  await database.exec(`
    insert into public.warehouses(id,workspace_id,name) values ('${warehouseA}','${workspaceId}','A'),('${warehouseB}','${workspaceId}','B');
    insert into public.stock_items(id,workspace_id,sku,name,unit) values ('${itemId}','${workspaceId}','TEST','Rura testowa DN110','m');
    insert into public.stock_movements(id,workspace_id,warehouse_id,movement_type,status,approved_by,approved_at) values ('${movementId}','${workspaceId}','${warehouseA}','PZ','approved','${userId}',now());
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity) values ('${workspaceId}','${movementId}','${itemId}',10);
  `);
  const beforeTransfer = await database.query("select quantity from public.get_stock_balances($1) where warehouse_id=$2 and stock_item_id=$3", [workspaceId, warehouseA, itemId]);
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

  const order = await database.query("select * from public.create_purchase_order_atomic($1,$2,null,null,'ZAM-TEST',current_date,current_date+7,'Rura testowa DN110',$3,$4,5,'m',42,$5)", [workspaceId, projectId, itemId, boqId, userId]);
  if (!order.rows[0]?.result_order_id || Number(order.rows[0]?.total_amount) !== 210) throw new Error("Atomic purchase-order workflow failed.");
  const commitment = await database.query("select count(*)::integer count from public.commitments where workspace_id=$1 and project_id=$2 and source_type='purchase_order'", [workspaceId, projectId]);
  if (commitment.rows[0]?.count !== 1) throw new Error("Purchase order did not create its commitment.");

  const search = await database.query("select * from public.search_workspace_entities($1,'Test',20)", [workspaceId]);
  if (!search.rows.some((row) => row.entity_type === "project" && row.entity_id === projectId)) throw new Error("Workspace search did not find the project.");

  const anomalyCount = await database.query("select public.refresh_project_anomalies($1,$2) count", [workspaceId, projectId]);
  if (Number(anomalyCount.rows[0]?.count ?? 0) < 0) throw new Error("Anomaly refresh returned invalid result.");

  const command = await database.query("select public.get_project_command_center($1,$2) snapshot", [workspaceId, projectId]);
  const snapshot = command.rows[0]?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.cashflow13w) || snapshot.cashflow13w.length !== 13) throw new Error("Command Center did not build a 13-week cash flow.");

  console.log(`OK   full migration chain: ${migrations.length} migrations`);
  console.log("OK   company upload/assignment, manual stock integrity, atomic budget, warehouse ledger, MM, purchase order, search, anomalies and Command Center smoke tests");
} finally {
  await database.close();
}
