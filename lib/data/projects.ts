import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AuthenticatedUser, ProjectSummary } from "@/lib/types";
import { listCompanyWorkspacesForUser, userHasWorkspaceAccess } from "@/lib/data/workspace";

type ProjectRow = Pick<ProjectSummary, "id" | "workspace_id" | "name"> & Partial<ProjectSummary>;

function normalizeProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description ?? null,
    investor_name: row.investor_name ?? null,
    general_contractor: row.general_contractor ?? null,
    location: row.location ?? null,
    status: row.status ?? "active",
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? row.created_at ?? ""
  };
}

export async function listProjectsForWorkspace(
  user: AuthenticatedUser,
  workspaceId: string
): Promise<ProjectSummary[]> {
  if (!(await userHasWorkspaceAccess(user, workspaceId))) {
    return [];
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error(`Nie udało się pobrać inwestycji: ${error.message}`);
  }

  return (data ?? []).map(normalizeProject);
}

export async function listProjectsForUser(user: AuthenticatedUser): Promise<ProjectSummary[]> {
  const workspaces = await listCompanyWorkspacesForUser(user);
  const workspaceIds = workspaces.map((workspace) => workspace.id);

  if (workspaceIds.length === 0) {
    return [];
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .in("workspace_id", workspaceIds)
    .order("updated_at", { ascending: false })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error(`Nie udało się pobrać inwestycji: ${error.message}`);
  }

  return (data ?? []).map(normalizeProject);
}

export const getProjectForUser = cache(async function getProjectForUser(
  user: AuthenticatedUser,
  projectId: string
): Promise<ProjectSummary | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  if (error) {
    throw new Error(`Nie udało się pobrać inwestycji: ${error.message}`);
  }

  if (!data || !(await userHasWorkspaceAccess(user, data.workspace_id))) {
    return null;
  }

  return normalizeProject(data);
});

export async function userHasProjectAccess(user: AuthenticatedUser, projectId: string) {
  const project = await getProjectForUser(user, projectId);
  return project !== null;
}
