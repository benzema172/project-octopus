"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
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

  const { data, error } = await supabase
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

  if (error || !data) {
    throw new Error(`Nie udało się utworzyć inwestycji: ${error?.message ?? "brak danych"}`);
  }

  revalidatePath("/workspace");
  redirect(`/workspace/projects/${data.id}`);
}
