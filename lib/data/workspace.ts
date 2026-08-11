import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AuthenticatedUser, WorkspaceSummary } from "@/lib/types";

type WorkspaceMemberRow = {
  workspace_id: string;
  role: string;
  workspaces: WorkspaceSummary | WorkspaceSummary[] | null;
};

function isMissingOwnerId(message: string | undefined) {
  return Boolean(message?.includes("owner_id") && (message.includes("schema cache") || message.includes("does not exist")));
}

export const ensureWorkspaceForUser = cache(async function ensureWorkspaceForUser(
  user: AuthenticatedUser
): Promise<WorkspaceSummary> {
  const supabase = createServiceSupabaseClient();

  const readMembership = () =>
    supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<WorkspaceMemberRow>();

  let membershipResult = await readMembership();

  if (membershipResult.error?.message.includes("JWT issued at future")) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    membershipResult = await readMembership();
  }

  const { data: membership, error: membershipError } = membershipResult;

  if (membershipError) {
    throw new Error(`Nie udało się odczytać workspace użytkownika: ${membershipError.message}`);
  }

  if (membership?.workspaces) {
    const workspace = Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces;

    if (workspace) {
      return workspace;
    }
  }

  const workspaceName = user.email ? `Workspace ${user.email}` : "Workspace Project Octopus";

  let workspaceResult = await supabase
    .from("workspaces")
    .insert({
      name: workspaceName,
      owner_id: user.id
    })
    .select("id, name")
    .single<WorkspaceSummary>();

  if (isMissingOwnerId(workspaceResult.error?.message)) {
    workspaceResult = await supabase
      .from("workspaces")
      .insert({ name: workspaceName })
      .select("id, name")
      .single<WorkspaceSummary>();
  }

  const { data: workspace, error: workspaceError } = workspaceResult;

  if (workspaceError || !workspace) {
    throw new Error(`Nie udało się utworzyć workspace: ${workspaceError?.message ?? "brak danych"}`);
  }

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner"
  });

  if (memberError) {
    throw new Error(`Nie udało się przypisać użytkownika do workspace: ${memberError.message}`);
  }

  return workspace;
});
