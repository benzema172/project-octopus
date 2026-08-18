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
  "supabase/migrations/20260818074000_101_stock_and_document_integrity.sql",
  "supabase/migrations/20260818075000_101_finance_fleet_atomicity.sql",
  "supabase/migrations/20260818090000_102_stability.sql",
  "supabase/migrations/20260818100000_110_operating_scale.sql"
];

function withoutPgcrypto(sql) {
  return sql.replace("create extension if not exists pgcrypto;", "-- pgcrypto supplied by Supabase / PGlite built-ins in CI");
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
    "complete_document_upload","claim_next_processing_job","approve_estimate_import_atomic",
    "create_progress_entry_atomic","create_budget_version_atomic","save_project_profile_atomic",
    "reassign_invoice_atomic","issue_reservation_atomic","transfer_stock_atomic","record_meter_reading_atomic",
    "get_stock_balances","search_workspace_entities","get_project_cost_graph","create_purchase_order_atomic",
    "get_ai_quality_metrics","refresh_project_anomalies","refresh_project_anomalies_if_stale",
    "get_project_command_center","get_company_finance_kpis","generate_report_snapshot_atomic",
    "create_stock_movement_atomic","approve_stock_movement_atomic","assign_document_to_project_atomic",
    "record_payment_atomic","record_fuel_entry_atomic"
  ];
  for (const name of expectedFunctions) {
    const result = await database.query("select count(*)::integer count from pg_proc where pronamespace='public'::regnamespace and proname=$1", [name]);
    if (result.rows[0]?.count < 1) throw new Error(`Missing database function: ${name}`);
  }

  const markers = await database.query("select version from public.app_schema_versions where version like '20260817_%' or version like '20260818_%' order by version");
  if (markers.rows.length < 15) throw new Error(`Expected 0.9.1–1.1 schema markers, received ${markers.rows.length}.`);

  const userId="00000000-0000-4000-8000-000000000001";
  const workspaceId="00000000-0000-4000-8000-000000000002";
  const projectId="00000000-0000-4000-8000-000000000003";
  const boqId="00000000-0000-4000-8000-000000000004";
  await database.exec(`
    insert into auth.users(id) values ('${userId}');
    insert into public.workspaces(id,name,owner_id) values ('${workspaceId}','Octopus 1.1 test','${userId}');
    insert into public.workspace_members(workspace_id,user_id,role) values ('${workspaceId}','${userId}','owner');
    insert into public.projects(id,workspace_id,name,created_by) values ('${projectId}','${workspaceId}','Test 1.1','${userId}');
    insert into public.project_facts(project_id,fact_type,value_text,value_json,confidence,status)
      values ('${projectId}','project_profile','Test 1.1','{"projectName":"Test 1.1","status":"active","contractValue":"100000"}'::jsonb,1,'approved');
    insert into public.boq_items(id,project_id,item_number,description,quantity,unit,unit_price,total_price)
      values ('${boqId}','${projectId}','1.1','Rura testowa DN110',10,'m',40,400);
  `);

  // Company-level document finalization and later explicit atomic assignment.
  const documentId="00000000-0000-4000-8000-000000000005";
  const versionId="00000000-0000-4000-8000-000000000006";
  const upload=await database.query("select * from public.complete_document_upload($1,$2,$3,null,'instrukcja.pdf','general','application/pdf',128,'test','company/instrukcja.pdf','etag',null,$4,now())",[documentId,versionId,workspaceId,userId]);
  if (upload.rows[0]?.version_number!==1) throw new Error("Company document upload failed.");
  await database.query("select public.assign_document_to_project_atomic($1,$2,$3,$4)",[workspaceId,documentId,projectId,userId]);
  const assigned=await database.query("select d.project_id,dv.project_id version_project from public.documents d join public.document_versions dv on dv.id=$2 where d.id=$1",[documentId,versionId]);
  if (assigned.rows[0]?.project_id!==projectId||assigned.rows[0]?.version_project!==projectId) throw new Error("Atomic document assignment failed.");

  // Payments: partial payment works; silent overpayment must fail.
  const purchaseInvoiceId="00000000-0000-4000-8000-000000000008";
  const saleInvoiceId="00000000-0000-4000-8000-000000000009";
  await database.exec(`
    insert into public.invoices(id,workspace_id,invoice_number,direction,gross_amount,status) values
      ('${purchaseInvoiceId}','${workspaceId}','FV-ZAKUP','purchase',1000,'received'),
      ('${saleInvoiceId}','${workspaceId}','FV-SPRZEDAZ','sale',2000,'issued');
    insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,amount,allocation_percent,status) values
      ('${workspaceId}','${projectId}','invoice','${purchaseInvoiceId}',800,100,'approved'),
      ('${workspaceId}','${projectId}','invoice','${saleInvoiceId}',2000,100,'approved');
  `);
  const payment=await database.query("select * from public.record_payment_atomic($1,$2,current_date,400,'TEST',$3)",[workspaceId,purchaseInvoiceId,userId]);
  if(Number(payment.rows[0]?.paid_total)!==400||payment.rows[0]?.invoice_status!=="partially_paid") throw new Error("Partial payment workflow failed.");
  let overpaymentRejected=false;
  try{await database.query("select * from public.record_payment_atomic($1,$2,current_date,700,'TOO-MUCH',$3)",[workspaceId,purchaseInvoiceId,userId]);}catch{overpaymentRejected=true;}
  if(!overpaymentRejected) throw new Error("Invoice overpayment was not rejected.");

  // Company KPI coverage uses allocation percentage, not net-vs-gross amounts.
  const companyKpis=await database.query("select public.get_company_finance_kpis($1) kpi",[workspaceId]);
  const kpi=companyKpis.rows[0]?.kpi;
  if(Number(kpi?.allocationCoveragePct)!==100||Number(kpi?.unallocatedPurchase)!==0) throw new Error(`Company finance coverage is invalid: ${JSON.stringify(kpi)}`);

  // Warehouse ledger, negative-stock guard and MM.
  const warehouseA="00000000-0000-4000-8000-000000000011";
  const warehouseB="00000000-0000-4000-8000-000000000012";
  const itemId="00000000-0000-4000-8000-000000000013";
  const movementId="00000000-0000-4000-8000-000000000014";
  await database.exec(`
    insert into public.warehouses(id,workspace_id,name) values ('${warehouseA}','${workspaceId}','A'),('${warehouseB}','${workspaceId}','B');
    insert into public.stock_items(id,workspace_id,sku,name,unit) values ('${itemId}','${workspaceId}','TEST','Rura testowa DN110','m');
    insert into public.stock_movements(id,workspace_id,warehouse_id,movement_type,status,approved_by,approved_at) values ('${movementId}','${workspaceId}','${warehouseA}','PZ','approved','${userId}',now());
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity) values ('${workspaceId}','${movementId}','${itemId}',10);
  `);
  let negativeRejected=false;
  try{await database.query("select * from public.create_stock_movement_atomic($1,$2,$3,null,$4,'RW',99,null,'RW-TOO-MUCH',current_date,$5)",[workspaceId,projectId,warehouseA,itemId,userId]);}catch{negativeRejected=true;}
  if(!negativeRejected) throw new Error("Negative stock could be created.");
  await database.query("select * from public.transfer_stock_atomic($1,$2,$3,$4,$5,4,'MM-TEST',current_date,$6)",[workspaceId,projectId,warehouseA,warehouseB,itemId,userId]);
  const balances=await database.query("select warehouse_id,quantity from public.get_stock_balances($1) where stock_item_id=$2",[workspaceId,itemId]);
  const balanceMap=new Map(balances.rows.map((row)=>[row.warehouse_id,Number(row.quantity)]));
  if(balanceMap.get(warehouseA)!==6||balanceMap.get(warehouseB)!==4) throw new Error("MM ledger mismatch.");

  // Anomaly refresh is stale-aware and preserves first detection time.
  const overdueCommitmentId="00000000-0000-4000-8000-000000000015";
  await database.exec(`insert into public.commitments(id,workspace_id,project_id,source_type,description,amount,expected_date,status) values ('${overdueCommitmentId}','${workspaceId}','${projectId}','manual','Przeterminowane testowe',100,current_date-2,'open');`);
  const refresh1=await database.query("select public.refresh_project_anomalies_if_stale($1,$2,300) refreshed",[workspaceId,projectId]);
  if(refresh1.rows[0]?.refreshed!==true) throw new Error("First stale anomaly refresh did not run.");
  const anomaly1=await database.query("select detected_at,first_detected_at,last_seen_at from public.project_anomalies where project_id=$1 and anomaly_key=$2",[projectId,`auto:commitment:${overdueCommitmentId}`]);
  if(!anomaly1.rows[0]?.first_detected_at) throw new Error("Anomaly first_detected_at was not populated.");
  const refresh2=await database.query("select public.refresh_project_anomalies_if_stale($1,$2,300) refreshed",[workspaceId,projectId]);
  if(refresh2.rows[0]?.refreshed!==false) throw new Error("Fresh anomaly state was unnecessarily recomputed.");
  await database.query("update public.commitments set amount=125 where id=$1",[overdueCommitmentId]);
  const refresh3=await database.query("select public.refresh_project_anomalies_if_stale($1,$2,300) refreshed",[workspaceId,projectId]);
  if(refresh3.rows[0]?.refreshed!==true) throw new Error("Invalidated anomaly state did not refresh.");
  const anomaly2=await database.query("select detected_at,first_detected_at,last_seen_at from public.project_anomalies where project_id=$1 and anomaly_key=$2",[projectId,`auto:commitment:${overdueCommitmentId}`]);
  if(String(anomaly1.rows[0]?.detected_at)!==String(anomaly2.rows[0]?.detected_at)||String(anomaly1.rows[0]?.first_detected_at)!==String(anomaly2.rows[0]?.first_detected_at)) throw new Error("Anomaly history was reset during refresh.");

  // Report run + immutable snapshot must close atomically from server-side aggregates.
  const reportDefinitionId="00000000-0000-4000-8000-000000000016";
  await database.exec(`insert into public.report_definitions(id,workspace_id,project_id,name,report_type,definition,active,created_by) values ('${reportDefinitionId}','${workspaceId}','${projectId}','Raport testowy','project','{}'::jsonb,true,'${userId}');`);
  const report=await database.query("select public.generate_report_snapshot_atomic($1,$2,current_date-30,current_date,$3) snapshot_id",[workspaceId,reportDefinitionId,userId]);
  if(!report.rows[0]?.snapshot_id) throw new Error("Atomic report generator did not return a snapshot.");
  const reportState=await database.query("select rr.status,count(rs.id)::integer snapshots from public.report_runs rr left join public.report_snapshots rs on rs.report_run_id=rr.id where rr.report_definition_id=$1 group by rr.status",[reportDefinitionId]);
  if(reportState.rows[0]?.status!=="completed"||reportState.rows[0]?.snapshots!==1) throw new Error("Report run and snapshot are inconsistent.");

  // Unified FTS search and corrected Command Center finance semantics.
  const search=await database.query("select * from public.search_workspace_entities($1,'Test',20)",[workspaceId]);
  if(!search.rows.some((row)=>row.entity_type==="project"&&row.entity_id===projectId)) throw new Error("Unified workspace search did not find the project.");
  const command=await database.query("select public.get_project_command_center($1,$2) snapshot",[workspaceId,projectId]);
  const snapshot=command.rows[0]?.snapshot;
  if(!snapshot||!Array.isArray(snapshot.cashflow13w)||snapshot.cashflow13w.length!==13) throw new Error("Command Center did not build 13-week cash flow.");
  if(Number(snapshot.actualCost)!==800||Number(snapshot.allocatedRevenue)!==2000) throw new Error(`Command Center mixed revenue and project cost: ${JSON.stringify(snapshot)}`);
  if(Number(snapshot.financeCoverage?.allocationCoveragePct)!==100) throw new Error("Command Center finance coverage is invalid.");

  console.log(`OK   full migration chain: ${migrations.length} migrations`);
  console.log("OK   1.0.2 Stability + 1.1 finance semantics, stale anomalies, reports, stock, search and Command Center smoke tests");
} finally {
  await database.close();
}
