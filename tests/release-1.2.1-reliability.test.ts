import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Project Octopus 1.2.1 reliability regressions", () => {
  it("recovers from workspace errors using the POST-only sign-out endpoint", () => {
    const errorPage = read("app/workspace/error.tsx");
    const signOutRoute = read("app/auth/sign-out/route.ts");

    expect(errorPage).toContain('form action="/auth/sign-out" method="post"');
    expect(errorPage).not.toContain('href="/auth/sign-out"');
    expect(signOutRoute).toContain("export async function POST");
  });

  it("retries only the explicit Supabase JWT future clock-skew rejection", () => {
    const service = read("lib/supabase/service.ts");

    expect(service).toContain('const JWT_FUTURE_ERROR = "JWT issued at future"');
    expect(service).toContain("response.clone().text()");
    expect(service).toContain("fetch: retryingServiceFetch");
    expect(service).toContain("JWT_CLOCK_SKEW_RETRY_DELAYS_MS");
  });

  it("routes queued project documents and runs Autopilot with an auditable actor", () => {
    const worker = read("app/api/brain/worker/route.ts");

    expect(worker).toContain('select("document_id,project_id,file_name,uploaded_by")');
    expect(worker).toContain("user?.id ?? sourceVersion.uploaded_by");
    expect(worker).toContain("enrichDocumentWithInvestmentRouting");
    expect(worker).toContain("applyDocumentAutopilot");
    expect(worker).toContain("projectId: sourceVersion.project_id ?? analysis.proposedProjectId");
  });

  it("keeps uploaded_by in the database schema for cron-worker attribution", () => {
    const migration = read("supabase/migrations/20260811130000_project_octopus_mvp.sql");

    expect(migration).toContain("uploaded_by uuid references auth.users(id) on delete set null");
  });
});
