import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "supabase/migrations/20260811130000_project_octopus_mvp.sql",
  "supabase/migrations/20260812100000_project_octopus_foundation_fix.sql",
  "supabase/migrations/20260814090000_octopus_operating_system.sql",
  "supabase/migrations/20260814130000_octopus_execution_layer.sql",
  "supabase/migrations/20260814170000_atomic_estimate_approval.sql",
  "supabase/migrations/20260814180000_domain_access_hardening.sql",
  "supabase/migrations/20260817090000_document_taxonomy_and_ai_review.sql",
  "supabase/migrations/20260817130000_upload_security_and_atomic_document_review.sql"
];

function withoutPgcrypto(sql) {
  return sql.replace(
    "create extension if not exists pgcrypto;",
    "-- pgcrypto is built into Supabase; PGlite does not package this extension."
  );
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
const legacyDatabase = new PGlite();

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
    const sql = withoutPgcrypto(await readFile(migration, "utf8"));
    await database.exec(sql);
    console.log(`OK   ${migration}`);
  }

  const marker = await database.query(
    "select version from public.app_schema_versions where version = '20260814_execution_layer'"
  );
  const hardeningMarker = await database.query(
    "select version from public.app_schema_versions where version = '20260814_domain_access_hardening'"
  );
  const taxonomyMarker = await database.query(
    "select version from public.app_schema_versions where version = '20260817_document_taxonomy_and_ai_review'"
  );
  const securityMarker = await database.query(
    "select version from public.app_schema_versions where version = '20260817_upload_security_and_atomic_document_review'"
  );
  const uploadFunction = await database.query(`
    select proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'complete_document_upload'
  `);

  const claimFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'claim_next_processing_job'
  `);
  const searchFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'search_octopus'
  `);
  const estimateApprovalFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'approve_estimate_import_atomic'
  `);
  const publishGenerationFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'publish_generation_run_atomic'
  `);
  const secureUploadFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'complete_document_upload_secure'
  `);
  const atomicDocumentReviewFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'review_document_atomic'
  `);
  const staleRecoveryFunction = await database.query(`
    select proname from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'recover_stale_processing_jobs'
  `);
  const legacyProgressShape = await database.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'progress_entries'
      and column_name in ('workspace_id', 'project_id', 'progress_period_id', 'boq_item_id', 'value_accepted', 'evidence')
  `);
  const legacyGeneratedDocumentShape = await database.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'generated_documents'
      and column_name = 'workspace_id'
  `);

  if (marker.rows.length !== 1 || hardeningMarker.rows.length !== 1 || taxonomyMarker.rows.length !== 1 || securityMarker.rows.length !== 1 || uploadFunction.rows.length !== 1 || secureUploadFunction.rows.length !== 1 || atomicDocumentReviewFunction.rows.length !== 1 || staleRecoveryFunction.rows.length !== 1 || claimFunction.rows.length !== 1 || searchFunction.rows.length !== 1 || estimateApprovalFunction.rows.length !== 1 || publishGenerationFunction.rows.length !== 1 || legacyProgressShape.rows.length !== 6 || legacyGeneratedDocumentShape.rows.length !== 1) {
    throw new Error("Migration marker or atomic upload function is missing.");
  }

  await database.exec(`
    insert into auth.users (id) values ('00000000-0000-4000-8000-000000000001');
    insert into public.workspaces (id, name, owner_id)
    values ('00000000-0000-4000-8000-000000000002', 'Migration test', '00000000-0000-4000-8000-000000000001');
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'owner');
    insert into public.projects (id, workspace_id, name, created_by)
    values (
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      'Atomic upload test',
      '00000000-0000-4000-8000-000000000001'
    );
  `);

  const completeVersion = (versionId, objectKey) =>
    database.query(
      `select * from public.complete_document_upload(
        '00000000-0000-4000-8000-000000000004',
        $1,
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
        'test.pdf',
        'pdf',
        'application/pdf',
        128,
        'test-bucket',
        $2,
        'etag',
        null,
        '00000000-0000-4000-8000-000000000001',
        now()
      )`,
      [versionId, objectKey]
    );

  const firstVersion = await completeVersion(
    "00000000-0000-4000-8000-000000000005",
    "documents/version-1.pdf"
  );
  const secondVersion = await completeVersion(
    "00000000-0000-4000-8000-000000000006",
    "documents/version-2.pdf"
  );
  await completeVersion("00000000-0000-4000-8000-000000000005", "documents/version-1.pdf");

  const documentState = await database.query(`
    select d.current_version_id, count(dv.id)::integer as version_count
    from public.documents d
    join public.document_versions dv on dv.document_id = d.id
    where d.id = '00000000-0000-4000-8000-000000000004'
    group by d.current_version_id
  `);

  if (
    firstVersion.rows[0]?.version_number !== 1 ||
    secondVersion.rows[0]?.version_number !== 2 ||
    documentState.rows[0]?.version_count !== 2 ||
    documentState.rows[0]?.current_version_id !== "00000000-0000-4000-8000-000000000006"
  ) {
    throw new Error("Atomic upload function failed its versioning or replay test.");
  }

  const verifiedSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const secureUpload = await database.query(`select * from public.complete_document_upload_secure(
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    'verified.pdf', 'pdf', 'application/pdf', 256,
    'test-bucket', 'documents/verified.pdf', 'etag', '${verifiedSha}',
    '{"status":"passed","sha256":"${verifiedSha}","checks":["magic-bytes"]}'::jsonb,
    '00000000-0000-4000-8000-000000000001', now()
  )`);
  const secureUploadState = await database.query(`
    select security_status, security_report->>'sha256' as report_sha, security_scanned_at is not null as scanned
    from public.document_versions where id = '00000000-0000-4000-8000-000000000008'
  `);
  if (secureUpload.rows[0]?.version_number !== 1 || secureUploadState.rows[0]?.security_status !== "passed" || secureUploadState.rows[0]?.report_sha !== verifiedSha || secureUploadState.rows[0]?.scanned !== true) {
    throw new Error("Secure upload wrapper did not persist its verified report atomically.");
  }

  await database.exec(`
    insert into public.document_classifications (
      id, workspace_id, document_id, document_version_id, category, proposed_project_id,
      confidence, schema_version, status
    ) values (
      '00000000-0000-4000-8000-000000000051',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000006',
      'project', '00000000-0000-4000-8000-000000000003', 0.95, 'test-v1', 'proposed'
    );
    insert into public.source_references (
      id, project_id, document_id, document_version_id, section_label, quote
    ) values
      ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006', 'material', 'Rura PP 110'),
      ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006', 'device', 'Pompa P1');
    insert into public.project_facts (project_id, fact_type, value_text, source_reference_id, status)
    values ('00000000-0000-4000-8000-000000000003', 'test_fact', 'wartość', '00000000-0000-4000-8000-000000000052', 'proposed');
    insert into public.project_requirements (workspace_id, project_id, requirement_type, title, source_document_id, source_locator, status)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'work_stage', 'Etap testowy', '00000000-0000-4000-8000-000000000004', '{"document_version_id":"00000000-0000-4000-8000-000000000006"}', 'proposed');
    insert into public.protocol_requirements (workspace_id, project_id, protocol_type, title, status, source_reference_id)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'test', 'Protokół testowy', 'proposed', '00000000-0000-4000-8000-000000000052');
    insert into public.evidence_requirements (workspace_id, project_id, evidence_type, title, status, source_reference_id)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'protocol', 'Dowód testowy', 'proposed', '00000000-0000-4000-8000-000000000052');
    insert into public.document_extractions (
      workspace_id, project_id, document_id, document_version_id, extraction_type,
      schema_version, payload, status
    ) values (
      '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006',
      'document_context', 'test-v1',
      '{"materials":[{"name":"Rura PP 110","installation":"kanalizacja","specification":"SN8"}],"devices":[{"name":"Pompa P1","installation":"sanitarna","parameters":["Q=10"]}],"sourceReferenceMap":{"materials":["00000000-0000-4000-8000-000000000052"],"devices":["00000000-0000-4000-8000-000000000053"]}}',
      'proposed'
    );
  `);
  const approveDocument = () => database.query(`select * from public.review_document_atomic(
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004', true,
    '00000000-0000-4000-8000-000000000001', 'test atomowy'
  )`);
  const approvedDocument = await approveDocument();
  const approvedDocumentReplay = await approveDocument();
  const documentReviewState = await database.query(`
    select
      (select review_status from public.documents where id = '00000000-0000-4000-8000-000000000004') as review_status,
      (select status from public.project_facts where fact_type = 'test_fact') as fact_status,
      (select status from public.project_requirements where title = 'Etap testowy') as requirement_status,
      (select status from public.protocol_requirements where title = 'Protokół testowy') as protocol_status,
      (select status from public.evidence_requirements where title = 'Dowód testowy') as evidence_status,
      (select count(*)::integer from public.materials where name = 'Rura PP 110') as material_count,
      (select count(*)::integer from public.devices where name = 'Pompa P1') as device_count,
      (select count(*)::integer from public.audit_events where entity_id = '00000000-0000-4000-8000-000000000004' and event_type = 'document.approve') as audit_count
  `);
  if (
    approvedDocument.rows[0]?.result_status !== "approved" ||
    approvedDocumentReplay.rows[0]?.result_materials !== 1 ||
    documentReviewState.rows[0]?.review_status !== "approved" ||
    documentReviewState.rows[0]?.fact_status !== "approved" ||
    documentReviewState.rows[0]?.requirement_status !== "approved" ||
    documentReviewState.rows[0]?.protocol_status !== "required" ||
    documentReviewState.rows[0]?.evidence_status !== "missing" ||
    documentReviewState.rows[0]?.material_count !== 1 ||
    documentReviewState.rows[0]?.device_count !== 1 ||
    documentReviewState.rows[0]?.audit_count !== 2
  ) {
    throw new Error("Atomic document review failed publication, audit or replay checks.");
  }

  const globalUpload = await database.query(`select * from public.complete_document_upload(
    '00000000-0000-4000-8000-000000000014',
    '00000000-0000-4000-8000-000000000015',
    '00000000-0000-4000-8000-000000000002',
    null,
    'faktura.pdf',
    'invoice',
    'application/pdf',
    256,
    'test-bucket',
    'company/faktura.pdf',
    'etag',
    null,
    '00000000-0000-4000-8000-000000000001',
    now()
  )`);
  const globalState = await database.query(`
    select d.project_id, d.ai_status, di.status as intake_status, pj.status as job_status
    from public.documents d
    join public.document_intakes di on di.document_id = d.id
    join public.processing_jobs pj on pj.document_id = d.id
    where d.id = '00000000-0000-4000-8000-000000000014'
  `);
  if (globalUpload.rows[0]?.version_number !== 1 || globalState.rows[0]?.project_id !== null || globalState.rows[0]?.job_status !== "queued") {
    throw new Error("Company-wide upload or AI pipeline enqueue failed.");
  }

  const claimed = await database.query("select id,status,attempt_count from public.claim_next_processing_job('migration-test-worker', '00000000-0000-4000-8000-000000000002')");
  if (claimed.rows.length !== 1 || claimed.rows[0]?.status !== "running" || claimed.rows[0]?.attempt_count !== 1) {
    throw new Error("Atomic processing-job claim failed.");
  }
  await database.query("update public.processing_jobs set last_heartbeat_at = now() - interval '20 minutes' where id = $1", [claimed.rows[0].id]);
  const recovered = await database.query("select * from public.recover_stale_processing_jobs('00000000-0000-4000-8000-000000000002')");
  const recoveredState = await database.query("select status,error_code from public.processing_jobs where id = $1", [claimed.rows[0].id]);
  if (recovered.rows[0]?.result_requeued !== 1 || recovered.rows[0]?.result_dead_lettered !== 0 || recoveredState.rows[0]?.status !== "queued" || recoveredState.rows[0]?.error_code !== "STALE_RECOVERED") {
    throw new Error("Stale processing-job recovery failed.");
  }

  await database.exec(`
    insert into public.estimate_imports (
      id, workspace_id, project_id, document_id, document_version_id, status, detected_rows, created_by
    ) values (
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
      'review', 2, '00000000-0000-4000-8000-000000000001'
    );
    insert into public.estimate_import_rows (
      id, workspace_id, estimate_import_id, source_row, item_number, description,
      quantity, unit, unit_price, total_price, proposed_wbs_code, status
    ) values
      (
        '00000000-0000-4000-8000-000000000022',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000021',
        1, '1.1', 'Instalacja kanalizacji', 10, 'm', 100, 1000, '01', 'proposed'
      ),
      (
        '00000000-0000-4000-8000-000000000023',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000021',
        2, '1.2', 'Próba szczelności', 1, 'kpl', 500, 500, '02', 'proposed'
      );
  `);

  const approveEstimate = () => database.query(`select * from public.approve_estimate_import_atomic(
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000001'
  )`);
  const approvedEstimate = await approveEstimate();
  const approvedEstimateReplay = await approveEstimate();
  const estimateState = await database.query(`
    select
      (select count(*)::integer from public.boq_versions where project_id = '00000000-0000-4000-8000-000000000003') as boq_versions,
      (select count(*)::integer from public.boq_items where project_id = '00000000-0000-4000-8000-000000000003') as boq_items,
      (select count(*)::integer from public.schedule_baselines where project_id = '00000000-0000-4000-8000-000000000003') as baselines,
      (select count(*)::integer from public.schedule_activities where project_id = '00000000-0000-4000-8000-000000000003') as activities,
      (select status from public.estimate_imports where id = '00000000-0000-4000-8000-000000000021') as import_status
  `);
  if (
    approvedEstimate.rows[0]?.result_rows !== 2 ||
    approvedEstimate.rows[0]?.result_wbs_nodes !== 2 ||
    approvedEstimateReplay.rows[0]?.result_already_approved !== true ||
    estimateState.rows[0]?.boq_versions !== 1 ||
    estimateState.rows[0]?.boq_items !== 2 ||
    estimateState.rows[0]?.baselines !== 1 ||
    estimateState.rows[0]?.activities !== 2 ||
    estimateState.rows[0]?.import_status !== "approved"
  ) {
    throw new Error("Atomic estimate approval failed its transaction or replay test.");
  }

  await database.exec(`
    create or replace function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users (id) values ('00000000-0000-4000-8000-000000000031');
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000031', 'member');
    insert into public.domain_role_grants (workspace_id, user_id, domain, access_level, project_id, granted_by)
    values
      ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000031', 'finance', 'read', null, '00000000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000031', 'investments', 'read', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001');
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000031', false);
  `);
  const domainAccessState = await database.query(`
    select
      public.has_domain_access('00000000-0000-4000-8000-000000000002', 'finance', 'read', null) as finance_read,
      public.has_domain_access('00000000-0000-4000-8000-000000000002', 'finance', 'write', null) as finance_write,
      public.has_domain_access('00000000-0000-4000-8000-000000000002', 'hr', 'read', null) as hr_read,
      public.has_domain_access('00000000-0000-4000-8000-000000000002', 'investments', 'read', '00000000-0000-4000-8000-000000000003') as project_read,
      public.has_domain_access('00000000-0000-4000-8000-000000000002', 'investments', 'read', null) as company_investments_read
  `);
  if (
    domainAccessState.rows[0]?.finance_read !== true ||
    domainAccessState.rows[0]?.finance_write !== false ||
    domainAccessState.rows[0]?.hr_read !== false ||
    domainAccessState.rows[0]?.project_read !== true ||
    domainAccessState.rows[0]?.company_investments_read !== false
  ) {
    throw new Error("Domain access policy failed its level or project-scope test.");
  }
  await database.exec("select set_config('request.jwt.claim.sub', '', false)");

  await database.exec(`
    insert into public.templates (id, workspace_id, name, template_type, status)
    values ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000002', 'Protokół testowy', 'protocol', 'approved');
    insert into public.template_versions (id, workspace_id, template_id, version_number, status)
    values ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000041', 1, 'approved');
    insert into public.generation_runs (id, workspace_id, project_id, template_version_id, status, input_snapshot, created_by)
    values (
      '00000000-0000-4000-8000-000000000043',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000042',
      'draft', '{"document_type":"protocol"}'::jsonb,
      '00000000-0000-4000-8000-000000000001'
    );
  `);
  const publishGenerated = () => database.query(`select * from public.publish_generation_run_atomic(
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000043',
    '00000000-0000-4000-8000-000000000044',
    '00000000-0000-4000-8000-000000000045',
    'protocol-test.html', 'protocol', 'text/html', 512,
    'test-bucket', 'generated/protocol-test.html',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '00000000-0000-4000-8000-000000000001'
  )`);
  const published = await publishGenerated();
  const publishedReplay = await publishGenerated();
  const publicationState = await database.query(`
    select
      (select count(*)::integer from public.generated_documents where generation_run_id = '00000000-0000-4000-8000-000000000043') as generated_count,
      (select status from public.generation_runs where id = '00000000-0000-4000-8000-000000000043') as run_status,
      (select review_status from public.documents where id = '00000000-0000-4000-8000-000000000044') as review_status,
      (select security_status from public.document_versions where id = '00000000-0000-4000-8000-000000000045') as security_status
  `);
  if (
    published.rows[0]?.result_already_published !== false ||
    publishedReplay.rows[0]?.result_already_published !== true ||
    publicationState.rows[0]?.generated_count !== 1 ||
    publicationState.rows[0]?.run_status !== "approved" ||
    publicationState.rows[0]?.review_status !== "approved" ||
    publicationState.rows[0]?.security_status !== "passed"
  ) {
    throw new Error("Atomic generator publication failed its transaction or replay test.");
  }

  await prepareDatabase(legacyDatabase);
  await legacyDatabase.exec(`
    create table public.workspaces (
      id uuid primary key,
      name text not null,
      slug text,
      created_by uuid references auth.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.workspace_members (
      workspace_id uuid references public.workspaces(id),
      user_id uuid references auth.users(id),
      role text not null,
      created_at timestamptz not null default now(),
      primary key (workspace_id, user_id)
    );
    create table public.projects (
      id uuid primary key,
      workspace_id uuid references public.workspaces(id),
      name text not null,
      description text,
      investor_name text,
      status text,
      created_by uuid references auth.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.documents (
      id uuid primary key,
      project_id uuid references public.projects(id),
      original_filename text,
      document_type text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.document_versions (
      id uuid primary key,
      document_id uuid references public.documents(id),
      version_no integer,
      original_filename text,
      mime_type text,
      size_bytes bigint,
      storage_bucket text,
      storage_key text,
      status text,
      created_at timestamptz not null default now()
    );
    create table public.project_facts (
      id uuid primary key,
      project_id uuid references public.projects(id),
      fact_type text not null,
      value_text text,
      value_json jsonb,
      confidence numeric,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ai_runs (
      id uuid primary key,
      project_id uuid references public.projects(id),
      created_by uuid references auth.users(id)
    );

    insert into auth.users (id) values ('10000000-0000-4000-8000-000000000001');
    insert into public.workspaces (id, name, created_by)
    values ('10000000-0000-4000-8000-000000000002', 'Legacy', '10000000-0000-4000-8000-000000000001');
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'owner');
    insert into public.projects (id, workspace_id, name)
    values ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Legacy project');
    insert into public.documents (id, project_id, original_filename, document_type)
    values ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'legacy.pdf', 'pdf');
    insert into public.document_versions (
      id, document_id, version_no, original_filename, mime_type, size_bytes, storage_bucket, storage_key, status
    ) values (
      '10000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000004',
      1,
      'legacy.pdf',
      'application/pdf',
      256,
      'legacy-bucket',
      'legacy/document.pdf',
      'uploaded'
    );
  `);

  const compatibilityMigration = withoutPgcrypto(await readFile(migrations[1], "utf8"));
  await legacyDatabase.exec(compatibilityMigration);
  const legacyState = await legacyDatabase.query(`
    select
      w.owner_id,
      d.workspace_id as document_workspace_id,
      d.name as document_name,
      dv.project_id as version_project_id,
      dv.file_name as version_file_name
    from public.workspaces w
    join public.documents d on d.workspace_id = w.id
    join public.document_versions dv on dv.document_id = d.id
    where w.id = '10000000-0000-4000-8000-000000000002'
  `);

  const legacy = legacyState.rows[0];
  if (
    legacy?.owner_id !== "10000000-0000-4000-8000-000000000001" ||
    legacy?.document_workspace_id !== "10000000-0000-4000-8000-000000000002" ||
    legacy?.document_name !== "legacy.pdf" ||
    legacy?.version_project_id !== "10000000-0000-4000-8000-000000000003" ||
    legacy?.version_file_name !== "legacy.pdf"
  ) {
    throw new Error("Compatibility migration failed to map the legacy production schema.");
  }

  console.log("Fresh and legacy migrations, secure upload, stale-job recovery, atomic document/BOQ approvals, generator publication and domain access passed local PostgreSQL tests.");
} finally {
  await database.close();
  await legacyDatabase.close();
}
