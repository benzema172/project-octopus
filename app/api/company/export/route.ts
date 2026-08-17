import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getCompanyPowerToolsData, type CompanyPowerKind } from "@/lib/data/company-power-tools";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const runtime = "nodejs";

const DOMAIN: Record<CompanyPowerKind, Domain> = {
  finance: "finance",
  hr: "hr",
  warehouse: "warehouse",
  fleet: "fleet",
  reports: "reports"
};

function isKind(value: string | null): value is CompanyPowerKind {
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
    const data = await getCompanyPowerToolsData(workspace.id, kind) as Record<string, unknown>;
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
