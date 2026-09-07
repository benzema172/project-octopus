import { ToolCase } from "lucide-react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

function label(value: unknown) {
  return String(value ?? "").trim();
}

export async function ProjectEquipmentStrip430({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const db = createServiceSupabaseClient();
  const { data: instances, error } = await db.from("stock_item_instances")
    .select("id,stock_item_id,serial_number,asset_tag,condition,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("status", "assigned")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("Project Octopus: project equipment strip unavailable", { projectId, message: error.message });
    return null;
  }
  const rows = (instances ?? []) as Row[];
  if (!rows.length) return null;

  const itemIds = [...new Set(rows.map((row) => label(row.stock_item_id)).filter(Boolean))];
  const { data: items, error: itemError } = itemIds.length
    ? await db.from("stock_items").select("id,name").eq("workspace_id", workspaceId).in("id", itemIds)
    : { data: [], error: null };
  if (itemError) {
    console.error("Project Octopus: project equipment names unavailable", { projectId, message: itemError.message });
  }
  const itemById = new Map(((items ?? []) as Row[]).map((row) => [label(row.id), label(row.name)]));
  const preview = rows.slice(0, 3).map((row) => {
    const name = itemById.get(label(row.stock_item_id)) || "Sprzęt";
    const identity = label(row.serial_number) || label(row.asset_tag);
    return identity ? `${name} · ${identity}` : name;
  });

  return (
    <section className="pw-info-strip" aria-label="Sprzęt przypisany do inwestycji">
      <ToolCase size={15} aria-hidden="true" />
      <span><strong>Sprzęt na inwestycji: {rows.length}</strong>{preview.length ? ` · ${preview.join(" · ")}` : ""}{rows.length > preview.length ? ` · +${rows.length - preview.length}` : ""}</span>
    </section>
  );
}
