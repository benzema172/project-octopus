import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const worker = read("app/api/brain/worker/route.ts");
const migration = read("supabase/migrations/20260826111000_background_ai_queue_132.sql");
const release = read("RELEASE_1.3.2.md");
const allMigrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n");

describe("Project Octopus 1.3.2 — Background AI Queue", () => {
  it("keeps the historical 1.3.2 release record", () => {
    expect(release).toContain("Project Octopus 1.3.2");
  });

  it("schedules the hosted background wake-up every five minutes", () => {
    expect(migration).toContain("create extension if not exists pg_cron");
    expect(migration).toContain("create extension if not exists pg_net");
    expect(migration).toContain("octopus-background-ai-queue-132");
    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain("/api/brain/worker?limit=3");
    expect(migration).toContain("net.http_post");
  });

  it("keeps Gemini cooldown authoritative before a queued job can be claimed", () => {
    expect(allMigrations).toContain("pj.available_at <= now()");
    expect(migration).toContain("available_at <= now()");
  });

  it("authenticates background wake-ups with a token generated inside Supabase Vault", () => {
    expect(migration).toContain("octopus_background_worker_token");
    expect(migration).toContain("vault.create_secret");
    expect(migration).toContain("verify_background_worker_token");
    expect(migration).toContain("revoke all on function public.verify_background_worker_token");
    expect(migration).toContain("grant execute on function public.verify_background_worker_token(text) to service_role");
    expect(migration).not.toContain("sb_publishable_");
    expect(migration).not.toContain("eyJhbGciOi");
  });

  it("accepts the authenticated Supabase wake-up without requiring an active user session", () => {
    expect(worker).toContain('const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token"');
    expect(worker).toContain('supabase.rpc("verify_background_worker_token"');
    expect(worker).toContain("const systemAuthorized = cronAuthorized || backgroundAuthorized");
    expect(worker).toContain("authorizedByBackgroundQueue");
  });

  it("keeps both Vercel GET cron and POST background wake-ups on one worker implementation", () => {
    expect(worker).toContain("async function handleWorker(request: Request)");
    expect(worker).toMatch(/export async function POST[\s\S]*return handleWorker\(request\)/);
    expect(worker).toMatch(/export async function GET[\s\S]*return handleWorker\(request\)/);
  });
});
