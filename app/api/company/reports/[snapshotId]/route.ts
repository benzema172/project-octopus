import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Snapshot = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  data_snapshot: Record<string, unknown>;
  narrative: Record<string, unknown>;
  closed_at: string | null;
  created_at: string;
};

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function flatten(value: unknown, prefix = "", rows: Array<[string, unknown]> = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, rows);
    }
  } else {
    rows.push([prefix, value]);
  }
  return rows;
}

export async function GET(request: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const { snapshotId } = await params;
  const { data: snapshot, error } = await createServiceSupabaseClient()
    .from("report_snapshots")
    .select("id,workspace_id,project_id,data_snapshot,narrative,closed_at,created_at")
    .eq("id", snapshotId)
    .maybeSingle<Snapshot>();

  if (error || !snapshot) return NextResponse.json({ error: "Raport nie istnieje." }, { status: 404 });
  const workspace = await getWorkspaceForUser(user, snapshot.workspace_id);
  if (!workspace || !await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "reports", level: "read", projectId: snapshot.project_id })) {
    return NextResponse.json({ error: "Brak dostępu do raportu." }, { status: 403 });
  }

  const format = new URL(request.url).searchParams.get("format") ?? "json";
  const filename = `project-octopus-report-${snapshot.id}`;
  if (format === "csv") {
    const rows: Array<[string, unknown]> = [
      ["snapshot.id", snapshot.id],
      ["snapshot.closed_at", snapshot.closed_at ?? snapshot.created_at],
      ...flatten(snapshot.narrative, "narrative"),
      ...flatten(snapshot.data_snapshot, "data")
    ];
    const csv = ["pole,wartosc", ...rows.map(([key, value]) => `${csvCell(key)},${csvCell(value)}`)].join("\r\n");
    return new Response(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"` } });
  }

  return new Response(JSON.stringify(snapshot, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.json"` } });
}
