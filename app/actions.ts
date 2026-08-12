"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { EMPTY_PROJECT_PROFILE, saveProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import {
  ensureWorkspaceForUser,
  getWorkspaceForUser,
  getWorkspaceRoleForUser,
  isCompanyProfileSchemaReady
} from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

function textField(formData: FormData, key: string, max = 500) {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

export async function createCompanyAction(formData: FormData) {
  const user = await requireCurrentUser();

  if (!(await isCompanyProfileSchemaReady())) {
    throw new Error("Najpierw zastosuj migrację profilu firmy w Supabase.");
  }

  const name = textField(formData, "name", 180);

  if (name.length < 2) {
    throw new Error("Nazwa firmy musi mieć co najmniej 2 znaki.");
  }

  const supabase = createServiceSupabaseClient();
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      name,
      owner_id: user.id,
      tax_id: textField(formData, "tax_id", 32) || null,
      regon: textField(formData, "regon", 32) || null,
      street: textField(formData, "street", 220) || null,
      postal_code: textField(formData, "postal_code", 20) || null,
      city: textField(formData, "city", 120) || null,
      email: textField(formData, "email", 180) || null,
      phone: textField(formData, "phone", 60) || null,
      contact_person: textField(formData, "contact_person", 180) || null,
      industry: textField(formData, "industry", 180) || null,
      notes: textField(formData, "notes", 3000) || null
    })
    .select("id")
    .single<{ id: string }>();

  if (workspaceError || !workspace) {
    throw new Error(`Nie udało się utworzyć firmy: ${workspaceError?.message ?? "brak danych"}`);
  }

  const { error: membershipError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner"
  });

  if (membershipError) {
    await supabase.from("workspaces").delete().eq("id", workspace.id);
    throw new Error(`Nie udało się przypisać firmy do konta: ${membershipError.message}`);
  }

  revalidatePath("/workspace");
  redirect(`/workspace/companies/${workspace.id}`);
}

export async function updateCompanyAction(workspaceId: string, formData: FormData) {
  const user = await requireCurrentUser();
  const role = await getWorkspaceRoleForUser(user, workspaceId);

  if (!role || !["owner", "admin"].includes(role)) {
    throw new Error("Nie masz uprawnień do edycji danych firmy.");
  }

  if (!(await isCompanyProfileSchemaReady())) {
    throw new Error("Najpierw zastosuj migrację profilu firmy w Supabase.");
  }

  const name = textField(formData, "name", 180);

  if (name.length < 2) {
    throw new Error("Nazwa firmy musi mieć co najmniej 2 znaki.");
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      name,
      tax_id: textField(formData, "tax_id", 32) || null,
      regon: textField(formData, "regon", 32) || null,
      street: textField(formData, "street", 220) || null,
      postal_code: textField(formData, "postal_code", 20) || null,
      city: textField(formData, "city", 120) || null,
      email: textField(formData, "email", 180) || null,
      phone: textField(formData, "phone", 60) || null,
      contact_person: textField(formData, "contact_person", 180) || null,
      industry: textField(formData, "industry", 180) || null,
      notes: textField(formData, "notes", 3000) || null,
      updated_at: new Date().toISOString()
    })
    .eq("id", workspaceId);

  if (error) {
    throw new Error(`Nie udało się zapisać danych firmy: ${error.message}`);
  }

  revalidatePath("/workspace");
  revalidatePath(`/workspace/companies/${workspaceId}`, "layout");
  redirect(`/workspace/companies/${workspaceId}/settings?saved=1`);
}

export async function createProjectAction(formData: FormData) {
  const user = await requireCurrentUser();
  const requestedWorkspaceId = textField(formData, "workspace_id", 80);
  const workspace = requestedWorkspaceId
    ? await getWorkspaceForUser(user, requestedWorkspaceId)
    : await ensureWorkspaceForUser(user);

  if (!workspace) {
    throw new Error("Nie znaleziono firmy lub nie masz do niej dostępu.");
  }

  const supabase = createServiceSupabaseClient();
  const name = textField(formData, "name", 240);
  const investorName = textField(formData, "investor_name", 240);
  const location = textField(formData, "location", 240);
  const description = textField(formData, "description", 12000);

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
  revalidatePath(`/workspace/companies/${workspace.id}`);
  revalidatePath(`/workspace/companies/${workspace.id}/investments`);
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
  revalidatePath(`/workspace/companies/${project.workspace_id}`);
  revalidatePath(`/workspace/projects/${project.id}`, "layout");
  redirect(`/workspace/projects/${project.id}/data?saved=1`);
}
