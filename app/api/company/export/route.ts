import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import {
  getFinanceWorkspaceData,
  getFleetWorkspaceData,
  getHrWorkspaceData,
  getWarehouseWorkspaceData,
  type CompanyPageOptions
} from "@/lib/data/company-operations";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ExportKind = "finance" | "hr" | "warehouse" | "fleet" | "reports";
type ExportLoader = (workspaceId: string, options?: CompanyPageOptions) => Promise<Record<string, unknown>>;

const DOMAIN: Record<ExportKind, Domain> = {
  finance: "finance",
  hr: "hr",
  warehouse: "warehouse",
  fleet: "fleet",
  reports: "reports"
};

const LOADERS: Partial<Record<ExportKind, ExportLoader>> = {
  finance: getFinanceWorkspaceData,
  hr: getHrWorkspaceData,
  warehouse: getWarehouseWorkspaceData,
  fleet: getFleetWorkspaceData
};

function isKind(value: string | null): value is ExportKind {
  return value !== null && ["finance", "hr", "warehouse", "fleet", "reports"].includes(value);
}

function scalar(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value: unknown) {
  return `"${scalar(value).replaceAll('"', '""')}"`;
}

function toCsv(data: Record<string, unknown>) {
  const exportRows: Array<Record<string, unknown>> = [];
  for (const [section, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (row && typeof row === "object") exportRows.push({ section, ...(row as Record<string, unknown>) });
    }
  }
  const headers = Array.from(new Set(exportRows.flatMap((row) => Object.keys(row))));
  if (!headers.length) return "section\n";
  return [headers.map(csvCell).join(";"), ...exportRows.map((row) => headers.map((header) => csvCell(row[header])).join(";"))].join("\n");
}

function mergePage(target: Record<string, unknown>, page: Record<string, unknown>) {
  for (const [key, value] of Object.entries(page)) {
    if (key === "page") continue;
    if (!Array.isArray(value)) {
      if (!(key in target)) target[key] = value;
      continue;
    }
    const current = Array.isArray(target[key]) ? target[key] as unknown[] : [];
    target[key] = [...current, ...value];
  }
}

function dedupeArrays(data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    const seen = new Set<string>();
    data[key] = value.filter((row) => {
      if (!row || typeof row !== "object") return true;
      const record = row as Record<string, unknown>;
      const identity = record.id ? `id:${String(record.id)}` : JSON.stringify(record);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  return data;
}

async function loadPagedExport(workspaceId: string, loader: ExportLoader) {
  const first = await loader(workspaceId, { page: 1, pageSize: 100 });
  const merged: Record<string, unknown> = {};
  mergePage(merged, first);
  const pageMeta = first.page && typeof first.page === "object" ? first.page as Record<string, unknown> : {};
  const total = Math.max(0, Number(pageMeta.total ?? 0) || 0);
  const pages = Math.min(100, Math.max(1, Math.ceil(total / 100)));
  for (let page = 2; page <= pages; page += 1) {
    mergePage(merged, await loader(workspaceId, { page, pageSize: 100 }));
  }
  return dedupeArrays(merged);
}

async function loadReportsExport(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const [projects, definitions, runs] = await Promise.all([
    db.from("projects").select("id,name,status").eq("workspace_id", workspaceId).order("name").limit(1000),
    db.from("report_definitions").select("id,project_id,name,report_type,schedule_rule,active,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5000),
    db.from("report_runs").select("id,report_definition_id,project_id,period_start,period_end,status,finished_at,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5000)
  ]);
  for (const result of [projects, definitions, runs]) if (result.error) throw new Error(result.error.message);
  return { projects: projects.data ?? [], definitions: definitions.data ?? [], runs: runs.data ?? [] };
}

async function loadExportData(workspaceId: string, kind: ExportKind) {
  if (kind === "reports") return loadReportsExport(workspaceId);
  const loader = LOADERS[kind];
  if (!loader) throw new Error("Brak loadera eksportu dla wybranego modułu.");
  return loadPagedExport(workspaceId, loader);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const kind = url.searchParams.get("kind");
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  if (!workspaceId || !isKind(kind)) return NextResponse.json({ error: "Nieprawidłowy zakres eksportu." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: DOMAIN[kind], level: "read" })) {
    return NextResponse.json({ error: "Brak uprawnienia do eksportu tego modułu." }, { status: 403 });
  }

  try {
    const data = await loadExportData(workspace.id, kind) as Record<string, unknown>;
    const date = new Date().toISOString().slice(0, 10);
    const base = `octopus-${kind}-${date}`;
    if (format === "json") {
      return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), workspace: workspace.name, kind, data }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.json"` }
      });
    }
    return new NextResponse(`\uFEFF${toCsv(data)}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się przygotować eksportu." }, { status: 500 });
  }
}
