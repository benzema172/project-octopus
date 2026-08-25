import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AuthenticatedUser, CompanyWorkspace, WorkspaceSummary } from "@/lib/types";

type WorkspaceMemberRow = {
  workspace_id: string;
  role: string;
};

type CompanyRow = Pick<CompanyWorkspace, "id" | "name"> & Partial<CompanyWorkspace>;

const COMPANY_COLUMNS =
  "id, name, tax_id, regon, street, postal_code, city, email, phone, contact_person, industry, notes, created_at, updated_at";

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

function isMissingColumn(message: string | undefined, column: string) {
  return Boolean(message?.includes(column) && (message.includes("schema cache") || message.includes("does not exist")));
}

function isMissingWorkspaceProjectCountsFunction(message: string | undefined) {
  return Boolean(message?.includes("get_workspace_project_counts") && (
    message.includes("schema cache") || message.includes("Could not find the function") || message.includes("does not exist")
  ));
}

function isMissingOwnerId(message: string | undefined) {
  return isMissingColumn(message, "owner_id");
}

function isMissingCreatedBy(message: string | undefined) {
  return isMissingColumn(message, "created_by");
}

function isMissingCompanyProfileColumn(message: string | undefined) {
  if (!message) {
    return false;
  }

  return ["tax_id", "regon", "street", "postal_code", "contact_person", "industry", "notes"].some(
    (column) => message.includes(column) && (message.includes("schema cache") || message.includes("does not exist"))
  );
}

async function readCompanyRows(ids: string[]) {
  if (ids.length === 0) {
    return [] as CompanyRow[];
  }

  const supabase = createServiceSupabaseClient();
  let result = await supabase.from("workspaces").select(COMPANY_COLUMNS).in("id", ids).returns<CompanyRow[]>();

  if (isMissingCompanyProfileColumn(result.error?.message)) {
    result = await supabase
      .from("workspaces")
      .select("id, name, created_at, updated_at")
      .in("id", ids)
      .returns<CompanyRow[]>();
  }

  if (result.error) {
    throw new Error(`Nie udało się pobrać firm: ${result.error.message}`);
  }

  return result.data ?? [];
}

async function listMemberships(user: AuthenticatedUser): Promise<WorkspaceMemberRow[]> {
  const supabase = createServiceSupabaseClient();
  let result = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .returns<WorkspaceMemberRow[]>();

  if (result.error?.message.includes("JWT issued at future")) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    result = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .returns<WorkspaceMemberRow[]>();
  }

  if (result.error) {
    throw new Error(`Nie udało się odczytać firm użytkownika: ${result.error.message}`);
  }

  return result.data ?? [];
}

export const ensureWorkspaceForUser = cache(async function ensureWorkspaceForUser(
  user: AuthenticatedUser
): Promise<WorkspaceSummary> {
  const memberships = await listMemberships(user);

  if (memberships[0]) {
    const rows = await readCompanyRows([memberships[0].workspace_id]);
    const workspace = rows[0];

    if (workspace) {
      return { id: workspace.id, name: workspace.name };
    }
  }

  const supabase = createServiceSupabaseClient();
  const workspaceName = user.email ? `Firma ${user.email}` : "Firma Project Octopus";

  let workspaceResult = await supabase
    .from("workspaces")
    .insert({
      name: workspaceName,
      created_by: user.id,
      owner_id: user.id
    })
    .select("id, name")
    .single<WorkspaceSummary>();

  if (isMissingOwnerId(workspaceResult.error?.message)) {
    const workspaceSlug = `workspace-${user.id}`;

    workspaceResult = await supabase
      .from("workspaces")
      .insert({
        name: workspaceName,
        slug: workspaceSlug,
        created_by: user.id
      })
      .select("id, name")
      .single<WorkspaceSummary>();
  } else if (isMissingCreatedBy(workspaceResult.error?.message)) {
    workspaceResult = await supabase
      .from("workspaces")
      .insert({
        name: workspaceName,
        owner_id: user.id
      })
      .select("id, name")
      .single<WorkspaceSummary>();
  }

  const { data: workspace, error: workspaceError } = workspaceResult;

  if (workspaceError || !workspace) {
    throw new Error(`Nie udało się utworzyć firmy: ${workspaceError?.message ?? "brak danych"}`);
  }

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

export const listCompanyWorkspacesForUser = cache(async function listCompanyWorkspacesForUser(
  user: AuthenticatedUser
): Promise<CompanyWorkspace[]> {
  let memberships = await listMemberships(user);

  if (memberships.length === 0) {
    await ensureWorkspaceForUser(user);
    memberships = await listMemberships(user);
  }

  const workspaceIds = memberships.map((membership) => membership.workspace_id);
  const rows = await readCompanyRows(workspaceIds);
  const roleByWorkspace = new Map(memberships.map((membership) => [membership.workspace_id, membership.role]));
  const supabase = createServiceSupabaseClient();
  const projectCount = new Map<string, number>();
  const { data: projectCountsRaw, error: projectCountsError } = await supabase.rpc("get_workspace_project_counts", {
    p_workspace_ids: workspaceIds
  });
  const projectCounts = (projectCountsRaw ?? []) as unknown as Array<{ workspace_id: string; project_count: number }>;

  if (projectCountsError && !isMissingWorkspaceProjectCountsFunction(projectCountsError.message)) {
    throw new Error(`Nie udało się policzyć inwestycji firm: ${projectCountsError.message}`);
  }

  if (!projectCountsError) {
    for (const row of projectCounts ?? []) projectCount.set(String(row.workspace_id), Number(row.project_count ?? 0));
  } else {
    // Compatibility fallback for an older production schema: count rows without downloading project payloads.
    await Promise.all(workspaceIds.map(async (workspaceId) => {
      const { count, error } = await supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(`Nie udało się policzyć inwestycji firmy: ${error.message}`);
      projectCount.set(workspaceId, count ?? 0);
    }));
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));

  return workspaceIds
    .map((workspaceId) => {
      const row = rowById.get(workspaceId);
      return row ? normalizeCompany(row, roleByWorkspace.get(workspaceId), projectCount.get(workspaceId) ?? 0) : null;
    })
    .filter((workspace): workspace is CompanyWorkspace => workspace !== null);
});

export const getWorkspaceForUser = cache(async function getWorkspaceForUser(
  user: AuthenticatedUser,
  workspaceId: string
): Promise<CompanyWorkspace | null> {
  const supabase = createServiceSupabaseClient();
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle<WorkspaceMemberRow>();

  if (membershipError) {
    throw new Error(`Nie udało się sprawdzić dostępu do firmy: ${membershipError.message}`);
  }

  if (!membership) {
    return null;
  }

  const rows = await readCompanyRows([workspaceId]);
  return rows[0] ? normalizeCompany(rows[0], membership.role) : null;
});

export async function getWorkspaceRoleForUser(user: AuthenticatedUser, workspaceId: string) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();

  if (error) {
    throw new Error(`Nie udało się sprawdzić roli w firmie: ${error.message}`);
  }

  return data?.role ?? null;
}

export async function userHasWorkspaceAccess(user: AuthenticatedUser, workspaceId: string) {
  return (await getWorkspaceForUser(user, workspaceId)) !== null;
}

export const isCompanyProfileSchemaReady = cache(async function isCompanyProfileSchemaReady() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("app_schema_versions")
    .select("version")
    .eq("version", "20260812_company_workspace_shell")
    .maybeSingle<{ version: string }>();

  return !error && data?.version === "20260812_company_workspace_shell";
});
