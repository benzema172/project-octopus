import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "supabase/migrations/20260811130000_project_octopus_mvp.sql",
  "supabase/migrations/20260812100000_project_octopus_foundation_fix.sql"
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
    const sql = withoutPgcrypto(await readFile(migration, "utf8"));
    await database.exec(sql);
    console.log(`OK   ${migration}`);
  }

  const marker = await database.query(
    "select version from public.app_schema_versions where version = '20260812_foundation_fix'"
  );
  const uploadFunction = await database.query(`
    select proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'complete_document_upload'
  `);

  if (marker.rows.length !== 1 || uploadFunction.rows.length !== 1) {
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

  console.log("Fresh and legacy migrations plus atomic versioning passed local PostgreSQL tests.");
} finally {
  await database.close();
  await legacyDatabase.close();
}
