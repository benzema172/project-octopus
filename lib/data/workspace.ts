import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AuthenticatedUser, CompanyWorkspace, WorkspaceSummary } from "@/lib/types";

type WorkspaceMemberRow = {
  workspace_id: string;
  role: string;
};

type CompanyRow = Pick<CompanyWorkspace, "id" | "name"> & Partial<CompanyWorkspace>;
type RetryableResult = { error: { message?: string } | null };

const COMPANY_COLUMNS =
  "id, name, tax_id, regon, street, postal_code, city, email, phone, contact_person, industry, notes, created_at, updated_at";
const JWT_CLOCK_SKEW = "JWT issued at future";
const JWT_RETRY_DELAYS_MS = [0, 250, 750, 1500];

function normalizeCompany(row: CompanyRow, role?: string, projectCount?: number): CompanyWorkspace {
  return {
    id: row.id,
    name: row.name,
    tax_id: row.tax_id ?? null,
    regon: row.regon ?? null,
    street: row.street ?? null,
    postal_code: row.postal_code ?? null,
    city: row.city ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    contact_person: row.contact_person ?? null,
    industry: row.industry ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? row.created_at ?? "",
    role,
    project_count: projectCount
  };
}

function isMissingOwnerId(message: string | undefined) {
  return Boolean(message?.includes("owner_id") && (message.includes("schema cache") || message.includes("does not exist")));
}

function isMissingCompanyProfileColumn(message: string | undefined) {
  if (!message) return false;
  return ["tax_id", "regon", "street", "postal_code", "contact_person", "industry", "notes"].some(
    (column) => message.includes(column) && (message.includes("schema cache") || message.includes("does not exist"))
  );
}

function isJwtClockSkew(message: string | undefined) {
  return Boolean(message?.includes(JWT_CLOCK_SKEW));
}

async function withJwtClockSkewRetry<T extends RetryableResult>(label: string, operation: () => PromiseLike<T>): Promise<T> {
  let lastResult: T | null = null;
  for (const delay of JWT_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const result = await operation();
    lastResult = result;
    if (!isJwtClockSkew(result.error?.message)) return result;
  }
  console.error("Project Octopus: JWT clock-skew retry exhausted", { label, attempts: JWT_RETRY_DELAYS_MS.length });
  return lastResult!;
}

async function readCompanyRows(ids: string[]) {
  if (ids.length === 0) return [] as CompanyRow[];

  const supabase = createServiceSupabaseClient();
  let result = await withJwtClockSkewRetry("company rows", () =>
    supabase.from("workspaces").select(COMPANY_COLUMNS).in("id", ids).returns<CompanyRow[]>()
  );

  if (isMissingCompanyProfileColumn(result.error?.message)) {
    result = await withJwtClockSkewRetry("company rows legacy", () =>
      supabase.from("workspaces").select("id, name, created_at, updated_at").in("id", ids).returns<CompanyRow[]>()
    );
  }

  if (result.error) throw new Error(`Nie udało się pobrać firm: ${result.error.message}`);
  return result.data ?? [];
}

async function listMemberships(user: AuthenticatedUser): Promise<WorkspaceMemberRow[]> {
  const supabase = createServiceSupabaseClient();
  const result = await withJwtClockSkewRetry("workspace memberships", () =>
    supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .returns<WorkspaceMemberRow[]>()
  );

  if (result.error) throw new Error(`Nie udało się odczytać firm użytkownika: ${result.error.message}`);
  return result.data ?? [];
}

export const ensureWorkspaceForUser = cache(async function ensureWorkspaceForUser(
  user: AuthenticatedUser
): Promise<WorkspaceSummary> {
  const memberships = await listMemberships(user);

  if (memberships[0]) {
    const rows = await readCompanyRows([memberships[0].workspace_id]);
    const workspace = rows[0];
    if (workspace) return { id: workspace.id, name: workspace.name };
  }

  const supabase = createServiceSupabaseClient();
  const workspaceName = user.email ? `Firma ${user.email}` : "Firma Project Octopus";

  let workspaceResult = await supabase
    .from("workspaces")
    .insert({ name: workspaceName, owner_id: user.id })
    .select("id, name")
    .single<WorkspaceSummary>();

  if (isMissingOwnerId(workspaceResult.error?.message)) {
    const workspaceSlug = `workspace-${user.id}`;
    workspaceResult = await supabase
      .from("workspaces")
      .insert({ name: workspaceName, slug: workspaceSlug, created_by: user.id })
      .select("id, name")
      .single<WorkspaceSummary>();
  }

  const { data: workspace, error: workspaceError } = workspaceResult;
  if (workspaceError || !workspace) throw new Error(`Nie udało się utworzyć firmy: ${workspaceError?.message ?? "brak danych"}`);

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner"
  });

  if (memberError) {
    await supabase.from("workspaces").delete().eq("id", workspace.id);
    throw new Error(`Nie udało się przypisać użytkownika do firmy: ${memberError.message}`);
  }

  return workspace;
});

export async function listCompanyWorkspacesForUser(user: AuthenticatedUser): Promise<CompanyWorkspace[]> {
  let memberships = await listMemberships(user);
  if (memberships.length === 0) {
    await ensureWorkspaceForUser(user);
    memberships = await listMemberships(user);
  }

  const workspaceIds = memberships.map((membership) => membership.workspace_id);
  const rows = await readCompanyRows(workspaceIds);
  const roleByWorkspace = new Map(memberships.map((membership) => [membership.workspace_id, membership.role]));
  const supabase = createServiceSupabaseClient();
  const projectsResult = await withJwtClockSkewRetry("workspace project counts", () =>
    supabase.from("projects").select("workspace_id").in("workspace_id", workspaceIds).returns<Array<{ workspace_id: string }>>()
  );
  if (projectsResult.error) throw new Error(`Nie udało się policzyć inwestycji firm: ${projectsResult.error.message}`);

  const projectCount = new Map<string, number>();
  for (const project of projectsResult.data ?? []) {
    projectCount.set(project.workspace_id, (projectCount.get(project.workspace_id) ?? 0) + 1);
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return workspaceIds
    .map((workspaceId) => {
      const row = rowById.get(workspaceId);
      return row ? normalizeCompany(row, roleByWorkspace.get(workspaceId), projectCount.get(workspaceId) ?? 0) : null;
    })
    .filter((workspace): workspace is CompanyWorkspace => workspace !== null);
}

export const getWorkspaceForUser = cache(async function getWorkspaceForUser(
  user: AuthenticatedUser,
  workspaceId: string
): Promise<CompanyWorkspace | null> {
  const supabase = createServiceSupabaseClient();
  const membershipResult = await withJwtClockSkewRetry("workspace access", () =>
    supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle<WorkspaceMemberRow>()
  );
  if (membershipResult.error) throw new Error(`Nie udało się sprawdzić dostępu do firmy: ${membershipResult.error.message}`);
  if (!membershipResult.data) return null;

  const rows = await readCompanyRows([workspaceId]);
  return rows[0] ? normalizeCompany(rows[0], membershipResult.data.role) : null;
});

export async function getWorkspaceRoleForUser(user: AuthenticatedUser, workspaceId: string) {
  const supabase = createServiceSupabaseClient();
  const result = await withJwtClockSkewRetry("workspace role", () =>
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle<{ role: string }>()
  );
  if (result.error) throw new Error(`Nie udało się sprawdzić roli w firmie: ${result.error.message}`);
  return result.data?.role ?? null;
}

export async function userHasWorkspaceAccess(user: AuthenticatedUser, workspaceId: string) {
  return (await getWorkspaceForUser(user, workspaceId)) !== null;
}

export async function isCompanyProfileSchemaReady() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("app_schema_versions")
    .select("version")
    .eq("version", "20260812_company_workspace_shell")
    .maybeSingle<{ version: string }>();
  return !error && data?.version === "20260812_company_workspace_shell";
}
