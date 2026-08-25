import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = "supabase/migrations";
const migrations = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => `${migrationDirectory}/${name}`);

if (!migrations.length) throw new Error("No Supabase migrations found.");

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

  const requiredFunctions = [
    "get_project_command_center",
    "get_project_command_panel_snapshot",
    "get_project_reconciliation_snapshot",
    "get_project_execution_snapshot",
    "get_project_autopilot_snapshot",
    "get_workspace_project_counts",
    "canonical_document_category",
    "complete_document_upload_v2",
    "review_document_analysis_atomic",
    "trg_orchestrate_approved_business_document",
    "create_report_snapshot_atomic",
    "enqueue_automation_notifications_atomic",
    "create_employment_atomic"
  ];
  for (const name of requiredFunctions) {
    const result = await database.query(
      "select count(*)::integer count from pg_proc where pronamespace='public'::regnamespace and proname=$1",
      [name]
    );
    if (result.rows[0]?.count < 1) throw new Error(`Missing post-change database function: ${name}`);
  }

  const intakeColumns = await database.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_intakes'
      and column_name in ('requested_category', 'category_locked', 'match_metadata')
  `);
  if (intakeColumns.rows.length !== 3) throw new Error("Missing document routing columns on document_intakes.");

  const trigger = await database.query(`
    select count(*)::integer count
    from pg_trigger
    where tgrelid = 'public.documents'::regclass
      and tgname = 'orchestrate_approved_business_document'
      and not tgisinternal
  `);
  if (trigger.rows[0]?.count !== 1) throw new Error("Missing approved business document trigger.");

  const callableByAuthenticated = await database.query(`
    select
      has_function_privilege(
        'authenticated',
        'public.review_document_analysis_atomic(uuid,uuid,text,text,uuid,boolean,uuid,text)',
        'execute'
      ) review_allowed,
      has_function_privilege(
        'authenticated',
        'public.canonical_document_category(text)',
        'execute'
      ) category_mapper_allowed
  `);
  if (callableByAuthenticated.rows[0]?.review_allowed) throw new Error("Atomic document review RPC is exposed to authenticated clients.");
  if (!callableByAuthenticated.rows[0]?.category_mapper_allowed) throw new Error("Authenticated RLS cannot execute the category mapper.");

  const tablesWithoutRls = await database.query(`
    select c.relname table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by c.relname
  `);
  if (tablesWithoutRls.rows.length) {
    throw new Error(`Public tables without RLS: ${tablesWithoutRls.rows.map((row) => row.table_name).join(", ")}`);
  }

  const exposedDefinerFunctions = await database.query(`
    select p.oid::regprocedure::text function_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
    order by p.oid::regprocedure::text
  `);
  if (exposedDefinerFunctions.rows.length) {
    throw new Error(
      `SECURITY DEFINER functions exposed to client roles: ${exposedDefinerFunctions.rows
        .map((row) => row.function_name)
        .join(", ")}`
    );
  }

  const uncachedAuthPolicies = await database.query(`
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%auth.uid()%'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%SELECT auth.uid()%'
    order by tablename, policyname
  `);
  if (uncachedAuthPolicies.rows.length) {
    throw new Error(
      `RLS policies evaluate auth.uid() per row: ${uncachedAuthPolicies.rows
        .map((row) => `${row.tablename}.${row.policyname}`)
        .join(", ")}`
    );
  }

  const unindexedForeignKeys = await database.query(`
    select c.conrelid::regclass::text table_name, c.conname constraint_name
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.contype = 'f'
      and exists (
        select 1
        from unnest(c.conkey) fk(attnum)
        where not exists (
          select 1
          from pg_index i
          where i.indrelid = c.conrelid
            and i.indisvalid
            and i.indpred is null
            and fk.attnum = any(i.indkey)
        )
      )
    order by c.conrelid::regclass::text, c.conname
  `);
  if (unindexedForeignKeys.rows.length) {
    throw new Error(
      `Foreign key columns without an index: ${unindexedForeignKeys.rows
        .map((row) => `${row.table_name}.${row.constraint_name}`)
        .join(", ")}`
    );
  }

  const actorId = "00000000-0000-0000-0000-000000000001";
  const workspaceId = "00000000-0000-0000-0000-000000000010";
  const projectId = "00000000-0000-0000-0000-000000000020";
  const employeeId = "00000000-0000-0000-0000-000000000030";
  const reportDefinitionId = "00000000-0000-0000-0000-000000000040";
  await database.exec(`
    insert into auth.users(id) values ('${actorId}');
    insert into public.workspaces(id,name,owner_id) values ('${workspaceId}','Audit workspace','${actorId}');
    insert into public.workspace_members(workspace_id,user_id,role) values ('${workspaceId}','${actorId}','owner');
    insert into public.projects(id,workspace_id,name,created_by) values ('${projectId}','${workspaceId}','Audit project','${actorId}');
    insert into public.employees(id,workspace_id,employee_number,first_name,last_name,status)
    values ('${employeeId}','${workspaceId}','AUD-1','Jan','Audytowy','active');
    insert into public.report_definitions(id,workspace_id,name,report_type,definition,created_by)
    values ('${reportDefinitionId}','${workspaceId}','Audit report','management','{}'::jsonb,'${actorId}');
    insert into public.invoices(workspace_id,invoice_number,direction,issue_date,net_amount,tax_amount,gross_amount,paid_amount,status)
    values ('${workspaceId}','AUD/1','sale','2026-08-20',1000,230,1230,500,'approved');
    insert into public.commitments(workspace_id,project_id,source_type,description,amount,original_amount,expected_date,status)
    values ('${workspaceId}','${projectId}','manual','Audit commitment',200,200,'2026-08-25','open');
  `);

  const employment = await database.query(
    "select public.create_employment_atomic($1,$2,'employment','Auditor','2026-01-01',null,1,10000,100,$3) id",
    [workspaceId, employeeId, actorId]
  );
  if (!employment.rows[0]?.id) throw new Error("Atomic employment smoke test did not create a record.");
  let overlapRejected = false;
  try {
    await database.query(
      "select public.create_employment_atomic($1,$2,'employment','Auditor','2026-06-01','2026-12-31',1,10000,100,$3)",
      [workspaceId, employeeId, actorId]
    );
  } catch {
    overlapRejected = true;
  }
  if (!overlapRejected) throw new Error("Atomic employment smoke test accepted overlapping periods.");

  const notifications = JSON.stringify([
    {
      project_id: projectId,
      event_type: "commitment_due",
      title: "Audit alert",
      body: "First",
      severity: "warning",
      entity_type: "commitment",
      entity_id: "audit-commitment"
    },
    {
      project_id: projectId,
      event_type: "commitment_due",
      title: "Audit alert duplicate",
      body: "Second",
      severity: "warning",
      entity_type: "commitment",
      entity_id: "audit-commitment"
    }
  ]);
  const firstNotificationWrite = await database.query(
    "select public.enqueue_automation_notifications_atomic($1,$2::jsonb) inserted",
    [workspaceId, notifications]
  );
  const secondNotificationWrite = await database.query(
    "select public.enqueue_automation_notifications_atomic($1,$2::jsonb) inserted",
    [workspaceId, notifications]
  );
  if (firstNotificationWrite.rows[0]?.inserted !== 1 || secondNotificationWrite.rows[0]?.inserted !== 0) {
    throw new Error("Atomic notification smoke test did not deduplicate concurrent-equivalent writes.");
  }

  const report = await database.query(
    "select public.create_report_snapshot_atomic($1,$2,'2026-08-01','2026-08-31',$3) id",
    [workspaceId, reportDefinitionId, actorId]
  );
  const reportSnapshotId = report.rows[0]?.id;
  if (!reportSnapshotId) throw new Error("Atomic report smoke test did not create a snapshot.");
  const reportState = await database.query(
    `select
       rs.data_snapshot#>>'{finance,sales_gross}' sales_gross,
       rr.status,
       count(ae.id)::integer audit_events
     from public.report_snapshots rs
     join public.report_runs rr on rr.id=rs.report_run_id
     left join public.audit_events ae on ae.entity_type='report_snapshot' and ae.entity_id=rs.id::text
     where rs.id=$1
     group by rs.id,rr.status`,
    [reportSnapshotId]
  );
  if (reportState.rows[0]?.sales_gross !== "1230.00" || reportState.rows[0]?.status !== "completed" || reportState.rows[0]?.audit_events !== 1) {
    throw new Error("Atomic report smoke test produced an incomplete or inconsistent result.");
  }

  const wbs = await database.query(
    "select result_wbs_node_id id from public.upsert_wbs_node_atomic($1,$2,null,null,'SAN.WOD','Instalacja wodna','sanitarna','woda','Budynek A',10,$3)",
    [workspaceId, projectId, actorId]
  );
  const wbsId = wbs.rows[0]?.id;
  if (!wbsId) throw new Error("BOQ/WBS smoke test did not create a WBS node.");

  const baseline = await database.query(
    "select * from public.create_boq_revision_atomic($1,$2,null,'Baseline audytowy','baseline',null,$3)",
    [workspaceId, projectId, actorId]
  );
  const baselineId = baseline.rows[0]?.result_version_id;
  if (!baselineId) throw new Error("BOQ/WBS smoke test did not create a baseline draft.");
  await database.query(
    "select * from public.save_boq_revision_item_atomic($1,$2,$3,null,'1.1','Rurociąg audytowy','m',10,5,$4,'SAN-01',null,'Pozycja bazowa',$5)",
    [workspaceId, projectId, baselineId, wbsId, actorId]
  );
  await database.query("select * from public.submit_boq_version_atomic($1,$2,$3,$4)", [workspaceId, projectId, baselineId, actorId]);
  await database.query("select * from public.approve_boq_version_atomic($1,$2,$3,$4,'Baseline testowy')", [workspaceId, projectId, baselineId, actorId]);

  const changeOrder = await database.query(
    "select * from public.create_change_order_controlled_atomic($1,$2,'CO-AUD-1','Zmiana audytowa','Rozszerzenie zakresu',210,3,$3)",
    [workspaceId, projectId, actorId]
  );
  const changeOrderId = changeOrder.rows[0]?.result_change_order_id;
  const revision = await database.query(
    "select * from public.create_boq_revision_atomic($1,$2,$3,'Rewizja audytowa','change_order',$4,$5)",
    [workspaceId, projectId, baselineId, changeOrderId, actorId]
  );
  const revisionId = revision.rows[0]?.result_version_id;
  const clonedItem = await database.query("select id from public.boq_version_items where boq_version_id=$1 limit 1", [revisionId]);
  await database.query(
    "select * from public.save_boq_revision_item_atomic($1,$2,$3,$4,'1.1','Rurociąg audytowy','m',12,5,$5,'SAN-01',$6,'Zwiększenie ilości',$7)",
    [workspaceId, projectId, revisionId, clonedItem.rows[0]?.id, wbsId, changeOrderId, actorId]
  );
  await database.query(
    "select * from public.save_boq_revision_item_atomic($1,$2,$3,null,'1.2','Zawór audytowy','szt.',2,100,$4,'SAN-02',$5,'Nowy zakres',$6)",
    [workspaceId, projectId, revisionId, wbsId, changeOrderId, actorId]
  );
  await database.query("select * from public.submit_boq_version_atomic($1,$2,$3,$4)", [workspaceId, projectId, revisionId, actorId]);
  await database.query("select * from public.approve_boq_version_atomic($1,$2,$3,$4,'Akceptacja zmiany')", [workspaceId, projectId, revisionId, actorId]);

  const corrective = await database.query(
    "select * from public.create_boq_revision_atomic($1,$2,$3,'Korekta audytowa','corrective',null,$4)",
    [workspaceId, projectId, revisionId, actorId]
  );
  const correctiveId = corrective.rows[0]?.result_version_id;
  const removedItem = await database.query("select id from public.boq_version_items where boq_version_id=$1 and item_number='1.1'", [correctiveId]);
  await database.query("select * from public.remove_boq_revision_item_atomic($1,$2,$3,$4,$5)", [workspaceId, projectId, correctiveId, removedItem.rows[0]?.id, actorId]);
  await database.query("select * from public.submit_boq_version_atomic($1,$2,$3,$4)", [workspaceId, projectId, correctiveId, actorId]);
  await database.query("select * from public.approve_boq_version_atomic($1,$2,$3,$4,'Usunięcie pozycji')", [workspaceId, projectId, correctiveId, actorId]);

  const boqState = await database.query(
    `select
       count(*) filter(where is_active)::integer active_items,
       count(*) filter(where not is_active)::integer retired_items,
       coalesce(sum(total_price) filter(where is_active),0)::numeric active_value,
       (select status from public.boq_versions where id=$2) previous_status,
       (select status from public.change_orders where id=$3) change_order_status,
       (public.get_project_cost_graph($1,$4)#>>'{boq,items}')::integer graph_items
     from public.boq_items where project_id=$4`,
    [workspaceId, revisionId, changeOrderId, projectId]
  );
  const state = boqState.rows[0];
  if (state?.active_items !== 1 || state?.retired_items !== 1 || String(state?.active_value) !== "200.00" || state?.previous_status !== "superseded" || state?.change_order_status !== "approved" || state?.graph_items !== 1) {
    throw new Error("BOQ/WBS versioning smoke test produced an inconsistent active projection.");
  }

  console.log("OK   atomic employment, alerts, reports and BOQ/WBS Change Control smoke tests");

  console.log(`OK   full auto-discovered migration chain: ${migrations.length} migrations`);
} finally {
  await database.close();
}
