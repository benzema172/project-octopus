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
  "supabase/migrations/20260817220000_092_performance_search.sql",
  "supabase/migrations/20260817230000_094_cost_material_graph.sql",
  "supabase/migrations/20260817240000_095_ai_quality.sql",
  "supabase/migrations/20260817241000_095_analysis_retry_capture.sql",
  "supabase/migrations/20260817250000_100_command_center.sql",
  "supabase/migrations/20260817251000_100_command_center_nullsafe.sql"
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
      // Compatibility contract: production installations may already contain these legacy MVP tables.
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
    "get_ai_quality_metrics",
    "refresh_project_anomalies",
    "get_project_command_center"
  ];
  for (const name of expectedFunctions) {
    const result = await database.query("select count(*)::integer count from pg_proc where pronamespace='public'::regnamespace and proname=$1", [name]);
    if (result.rows[0]?.count < 1) throw new Error(`Missing database function: ${name}`);
  }

  const markers = await database.query("select version from public.app_schema_versions where version like '20260817_%' order by version");
  if (markers.rows.length < 7) throw new Error(`Expected 0.9.1–1.0 schema markers, received ${markers.rows.length}.`);

  const userId = "00000000-0000-4000-8000-000000000001";
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const projectId = "00000000-0000-4000-8000-000000000003";
  await database.exec(`
    insert into auth.users(id) values ('${userId}');
    insert into public.workspaces(id,name,owner_id) values ('${workspaceId}','Octopus 1.0 test','${userId}');
    insert into public.workspace_members(workspace_id,user_id,role) values ('${workspaceId}','${userId}','owner');
    insert into public.projects(id,workspace_id,name,created_by) values ('${projectId}','${workspaceId}','Test 1.0','${userId}');
    insert into public.project_facts(project_id,fact_type,value_text,value_json,confidence,status)
      values ('${projectId}','project_profile','Test 1.0','{"projectName":"Test 1.0","status":"active","contractValue":"100000"}'::jsonb,1,'approved');
  `);

  const firstBudget = await database.query("select * from public.create_budget_version_atomic($1,$2,'Budżet',100000,70000,$3)",[workspaceId,projectId,userId]);
  const secondBudget = await database.query("select * from public.create_budget_version_atomic($1,$2,'Budżet korekta',100000,75000,$3)",[workspaceId,projectId,userId]);
  if (firstBudget.rows[0]?.version_number !== 1 || secondBudget.rows[0]?.version_number !== 2) throw new Error("Atomic budget versioning failed.");

  const warehouseA="00000000-0000-4000-8000-000000000011";
  const warehouseB="00000000-0000-4000-8000-000000000012";
  const itemId="00000000-0000-4000-8000-000000000013";
  const movementId="00000000-0000-4000-8000-000000000014";
  await database.exec(`
    insert into public.warehouses(id,workspace_id,name) values ('${warehouseA}','${workspaceId}','A'),('${warehouseB}','${workspaceId}','B');
    insert into public.stock_items(id,workspace_id,sku,name,unit) values ('${itemId}','${workspaceId}','TEST','Materiał testowy','szt');
    insert into public.stock_movements(id,workspace_id,warehouse_id,movement_type,status,approved_by,approved_at) values ('${movementId}','${workspaceId}','${warehouseA}','PZ','approved','${userId}',now());
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity) values ('${workspaceId}','${movementId}','${itemId}',10);
  `);
  const beforeTransfer=await database.query("select quantity from public.get_stock_balances($1) where warehouse_id=$2 and stock_item_id=$3",[workspaceId,warehouseA,itemId]);
  if(Number(beforeTransfer.rows[0]?.quantity)!==10) throw new Error("Full stock ledger failed before MM.");
  await database.query("select * from public.transfer_stock_atomic($1,$2,$3,$4,$5,4,'MM-TEST',current_date,$6)",[workspaceId,projectId,warehouseA,warehouseB,itemId,userId]);
  const balances=await database.query("select warehouse_id,quantity from public.get_stock_balances($1) where stock_item_id=$2 order by warehouse_id",[workspaceId,itemId]);
  const balanceMap=new Map(balances.rows.map(row=>[row.warehouse_id,Number(row.quantity)]));
  if(balanceMap.get(warehouseA)!==6||balanceMap.get(warehouseB)!==4) throw new Error("Atomic stock transfer or full ledger failed.");

  const search=await database.query("select * from public.search_workspace_entities($1,'Test',20)",[workspaceId]);
  if(!search.rows.some(row=>row.entity_type==="project"&&row.entity_id===projectId)) throw new Error("Workspace search did not find the project.");

  const command=await database.query("select public.get_project_command_center($1,$2) snapshot",[workspaceId,projectId]);
  const snapshot=command.rows[0]?.snapshot;
  if(!snapshot||!Array.isArray(snapshot.cashflow13w)||snapshot.cashflow13w.length!==13) throw new Error("Command Center did not build a 13-week cash flow.");

  console.log(`OK   full migration chain: ${migrations.length} migrations`);
  console.log("OK   atomic budget, warehouse ledger, MM, search and Command Center smoke tests");
} finally {
  await database.close();
}
