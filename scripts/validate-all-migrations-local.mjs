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
    "get_project_autopilot_snapshot"
  ];
  for (const name of requiredFunctions) {
    const result = await database.query(
      "select count(*)::integer count from pg_proc where pronamespace='public'::regnamespace and proname=$1",
      [name]
    );
    if (result.rows[0]?.count < 1) throw new Error(`Missing post-change database function: ${name}`);
  }

  console.log(`OK   full auto-discovered migration chain: ${migrations.length} migrations`);
} finally {
  await database.close();
}
