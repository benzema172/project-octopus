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
    "canonical_document_category",
    "complete_document_upload_v2",
    "review_document_analysis_atomic",
    "trg_orchestrate_approved_business_document"
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

  console.log(`OK   full auto-discovered migration chain: ${migrations.length} migrations`);
} finally {
  await database.close();
}
