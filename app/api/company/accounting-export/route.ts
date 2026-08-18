import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "dekret";
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const entryId = url.searchParams.get("entryId")?.trim();
  if (!workspaceId || !entryId) return Response.json({ error: "Brakuje firmy lub dekretu." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return Response.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" })) {
    return Response.json({ error: "Brak uprawnienia do eksportu danych finansowych." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const { data: entry, error: entryError } = await db.from("accounting_entries")
    .select("id,project_id,status,description,entry_date")
    .eq("workspace_id", workspace.id)
    .eq("id", entryId)
    .maybeSingle<{ id: string; project_id: string | null; status: string; description: string; entry_date: string }>();
  if (entryError) return Response.json({ error: entryError.message }, { status: 422 });
  if (!entry) return Response.json({ error: "Dekret nie należy do aktywnej firmy." }, { status: 404 });
  if (entry.status !== "approved") return Response.json({ error: "Eksport jest dostępny dopiero po zatwierdzeniu dekretu." }, { status: 409 });

  const { data: payload, error } = await db.rpc("get_accounting_export_payload", {
    p_workspace_id: workspace.id,
    p_entry_id: entry.id
  });
  if (error) return Response.json({ error: error.message }, { status: 422 });
  if (!payload) return Response.json({ error: "Nie udało się zbudować pliku eksportu." }, { status: 422 });

  const exportedAt = new Date().toISOString();
  await db.from("accounting_entries").update({ exported_at: exportedAt }).eq("workspace_id", workspace.id).eq("id", entry.id);
  await db.from("audit_events").insert({
    workspace_id: workspace.id,
    project_id: entry.project_id,
    actor_id: user.id,
    actor_type: "user",
    event_type: "accounting.entry_exported",
    entity_type: "accounting_entry",
    entity_id: entry.id,
    after_value: { schema: "octopus-accounting-export-v1", exportedAt, format: "json" }
  });

  const filename = `octopus-${safeFilePart(entry.entry_date)}-${safeFilePart(entry.description)}-${entry.id.slice(0, 8)}.json`;
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
