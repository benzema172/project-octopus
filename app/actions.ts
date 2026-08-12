"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { EMPTY_PROJECT_PROFILE, saveProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function createProjectAction(formData: FormData) {
  const user = await requireCurrentUser();
  const workspace = await ensureWorkspaceForUser(user);
  const supabase = createServiceSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const investorName = String(formData.get("investor_name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (name.length < 2) {
    throw new Error("Nazwa inwestycji jest wymagana.");
  }

  let createResult = await supabase
    .from("projects")
    .insert({
      workspace_id: workspace.id,
      name,
      investor_name: investorName || null,
      location: location || null,
      description: description || null,
      status: "active",
      created_by: user.id
    })
    .select("id")
    .single<{ id: string }>();

  if (createResult.error?.message.includes("location")) {
    const compatibleDescription = [description, location ? `Lokalizacja: ${location}` : ""].filter(Boolean).join("\n\n");

    createResult = await supabase
      .from("projects")
      .insert({
        workspace_id: workspace.id,
        name,
        investor_name: investorName || null,
        description: compatibleDescription || null,
        status: "active",
        created_by: user.id
      })
      .select("id")
      .single<{ id: string }>();
  }

  const { data, error } = createResult;

  if (error || !data) {
    throw new Error(`Nie udało się utworzyć inwestycji: ${error?.message ?? "brak danych"}`);
  }

  const initialProfile = {
    ...EMPTY_PROJECT_PROFILE,
    projectName: name,
    status: "active",
    description,
    city: location,
    investorName
  };

  const { error: profileError } = await supabase.from("project_facts").insert({
    project_id: data.id,
    fact_type: "project_profile",
    value_text: name,
    value_json: initialProfile,
    confidence: 1
  });

  if (profileError) {
    await supabase.from("projects").delete().eq("id", data.id).eq("workspace_id", workspace.id);
    throw new Error(`Nie udało się utworzyć karty inwestycji: ${profileError.message}`);
  }

  revalidatePath("/workspace");
  redirect(`/workspace/projects/${data.id}`);
}

export async function updateProjectProfileAction(projectId: string, formData: FormData) {
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    throw new Error("Nie znaleziono inwestycji lub nie masz do niej dostępu.");
  }

  const profile = { ...EMPTY_PROJECT_PROFILE };

  for (const key of Object.keys(profile) as Array<keyof typeof profile>) {
    profile[key] = String(formData.get(key) ?? "").trim().slice(0, 12000);
  }

  if (profile.projectName.length < 2) {
    throw new Error("Nazwa inwestycji musi mieć co najmniej 2 znaki.");
  }

  const allowedStatuses = new Set(["planned", "tender", "active", "paused", "completed", "archived"]);
  profile.status = allowedStatuses.has(profile.status) ? profile.status : "active";
  profile.currency = profile.currency || "PLN";

  await saveProjectProfile(project, profile);

  revalidatePath("/workspace");
  revalidatePath(`/workspace/projects/${project.id}`, "layout");
  redirect(`/workspace/projects/${project.id}/data?saved=1`);
}
