import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AuthenticatedUser, ProjectSummary } from "@/lib/types";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";

export async function listProjectsForUser(user: AuthenticatedUser): Promise<ProjectSummary[]> {
  const workspace = await ensureWorkspaceForUser(user);
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, workspace_id, name, description, investor_name, general_contractor, location, status, created_at, updated_at")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false })
    .returns<ProjectSummary[]>();

  if (error) {
    throw new Error(`Nie udało się pobrać inwestycji: ${error.message}`);
  }

  return data ?? [];
}

export async function getProjectForUser(user: AuthenticatedUser, projectId: string): Promise<ProjectSummary | null> {
  const workspace = await ensureWorkspaceForUser(user);
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, workspace_id, name, description, investor_name, general_contractor, location, status, created_at, updated_at")
    .eq("workspace_id", workspace.id)
    .eq("id", projectId)
    .maybeSingle<ProjectSummary>();

  if (error) {
    throw new Error(`Nie udało się pobrać inwestycji: ${error.message}`);
  }

  return data;
}

export async function userHasProjectAccess(user: AuthenticatedUser, projectId: string) {
  const project = await getProjectForUser(user, projectId);
  return project !== null;
}
