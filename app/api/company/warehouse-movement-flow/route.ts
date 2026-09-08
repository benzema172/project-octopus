import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Row = Record<string, unknown>;
type Action = "route" | "approve" | "create" | "customer_create";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const validDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : null;

async function ownedId(table: string, value: unknown, workspaceId: string, label: string, optional = false) {
  const id = clean(value);
  if (!id) {
    if (optional) return null;
    throw new Error(`Uzupełnij pole: ${label}.`);
  }
  const { data, error } = await createServiceSupabaseClient()
    .from(table)
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
  return id;
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const workspace = workspaceId ? await getWorkspaceForUser(user, workspaceId) : null;
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "warehouse", level: "read" })) {
    return NextResponse.json({ error: "Brak dostępu do Magazynu." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const [movementsResult, counterpartiesResult, projectsResult, warehousesResult] = await Promise.all([
    db.from("stock_movements")
      .select("id,project_id,counterparty_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,source_document_id,source_invoice_id,source_group_key,destination_mode,approved_at,created_at")
      .eq("workspace_id", workspace.id)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(250),
    db.from("counterparties").select("id,name,tax_id,role,active").eq("workspace_id", workspace.id).eq("active", true).order("name").limit(1000),
    db.from("projects").select("id,name,status").eq("workspace_id", workspace.id).order("name").limit(500),
    db.from("warehouses").select("id,name,warehouse_type,active").eq("workspace_id", workspace.id).eq("active", true).order("name").limit(250)
  ]);
  if (movementsResult.error) return NextResponse.json({ error: `Nie udało się pobrać ruchów: ${movementsResult.error.message}` }, { status: 500 });
  if (counterpartiesResult.error || projectsResult.error || warehousesResult.error) {
    return NextResponse.json({ error: "Nie udało się pobrać słowników ruchów magazynowych." }, { status: 500 });
  }

  const movements = (movementsResult.data ?? []) as Row[];
  const movementIds = movements.map((row) => String(row.id)).filter(Boolean);
  const documentIds = [...new Set(movements.map((row) => String(row.source_document_id ?? "")).filter(Boolean))];

  const [linesResult, reviewsResult, documentsResult] = await Promise.all([
    movementIds.length
      ? db.from("stock_movement_lines").select("movement_id").eq("workspace_id", workspace.id).in("movement_id", movementIds).limit(15000)
      : Promise.resolve({ data: [] as Row[], error: null }),
    movementIds.length
      ? db.from("warehouse_document_reviews").select("draft_movement_id,supplier_name,document_name,document_number").eq("workspace_id", workspace.id).in("draft_movement_id", movementIds).limit(500)
      : Promise.resolve({ data: [] as Row[], error: null }),
    documentIds.length
      ? db.from("documents").select("id,name").eq("workspace_id", workspace.id).in("id", documentIds).limit(500)
      : Promise.resolve({ data: [] as Row[], error: null })
  ]);
  if (linesResult.error || reviewsResult.error || documentsResult.error) {
    return NextResponse.json({ error: "Nie udało się pobrać szczegółów ruchów magazynowych." }, { status: 500 });
  }

  const counts = new Map<string, number>();
  ((linesResult.data ?? []) as Row[]).forEach((row) => {
    const id = String(row.movement_id ?? "");
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  const reviewByMovement = new Map(((reviewsResult.data ?? []) as Row[]).map((row) => [String(row.draft_movement_id), row]));
  const documentById = new Map(((documentsResult.data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const counterpartyById = new Map(((counterpartiesResult.data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const projectById = new Map(((projectsResult.data ?? []) as Row[]).map((row) => [String(row.id), row]));
  const warehouseById = new Map(((warehousesResult.data ?? []) as Row[]).map((row) => [String(row.id), row]));

  return NextResponse.json({
    movements: movements.map((row) => {
      const review = reviewByMovement.get(String(row.id));
      const counterparty = counterpartyById.get(String(row.counterparty_id ?? ""));
      const sourceDocument = documentById.get(String(row.source_document_id ?? ""));
      const sourceGroup = String(row.source_group_key ?? "");
      const sourceLabel = row.source_document_id || sourceGroup.startsWith("warehouse-ai") ? "AI · Wrzutnia" : sourceGroup.startsWith("manual") ? "Ręczny" : "System";
      return {
        ...row,
        line_count: counts.get(String(row.id)) ?? 0,
        counterparty_name: counterparty?.name ?? review?.supplier_name ?? null,
        counterparty_role: counterparty?.role ?? null,
        project_name: projectById.get(String(row.project_id ?? ""))?.name ?? null,
        warehouse_name: warehouseById.get(String(row.warehouse_id ?? ""))?.name ?? null,
        target_warehouse_name: warehouseById.get(String(row.target_warehouse_id ?? ""))?.name ?? null,
        source_label: sourceLabel,
        source_document_name: sourceDocument?.name ?? review?.document_name ?? null
      };
    }),
    counterparties: counterpartiesResult.data ?? [],
    projects: projectsResult.data ?? [],
    warehouses: warehousesResult.data ?? []
  });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!body.workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const level = body.action === "approve" ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "warehouse", level })) {
    return NextResponse.json({ error: body.action === "approve" ? "Brak uprawnienia do zatwierdzania ruchów." : "Brak uprawnienia do zapisu w Magazynie." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const p = body.payload;

  try {
    if (body.action === "approve") {
      const movementId = await ownedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const { data, error } = await db.rpc("approve_stock_movement_atomic", {
        p_workspace_id: workspace.id,
        p_movement_id: movementId,
        p_actor_id: user.id
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data ?? movementId) });
    }

    if (body.action === "route") {
      const movementId = await ownedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const destinationMode = clean(p.destinationMode);
      if (!["central_stock", "direct_project", "external_customer", "unassigned"].includes(destinationMode)) throw new Error("Nieprawidłowe przeznaczenie ruchu.");
      const projectId = await ownedId("projects", p.projectId, workspace.id, "Inwestycja", true);
      const counterpartyId = await ownedId("counterparties", p.counterpartyId, workspace.id, "Kontrahent", true);
      const { data, error } = await db.rpc("set_stock_movement_route_atomic", {
        p_workspace_id: workspace.id,
        p_movement_id: movementId,
        p_destination_mode: destinationMode,
        p_project_id: projectId,
        p_counterparty_id: counterpartyId,
        p_actor_id: user.id
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data ?? movementId) });
    }

    if (body.action === "customer_create") {
      const name = clean(p.name);
      if (!name) throw new Error("Podaj nazwę klienta.");
      const taxId = nullable(p.taxId);
      if (taxId) {
        const existing = await db.from("counterparties").select("id,name,tax_id,role,active").eq("workspace_id", workspace.id).eq("tax_id", taxId).maybeSingle<Row>();
        if (existing.data) return NextResponse.json({ ok: true, counterparty: existing.data, reused: true });
      }
      const { data, error } = await db.from("counterparties").insert({
        workspace_id: workspace.id,
        name,
        tax_id: taxId,
        role: "customer",
        active: true
      }).select("id,name,tax_id,role,active").single<Row>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się utworzyć klienta.");
      return NextResponse.json({ ok: true, counterparty: data });
    }

    if (body.action === "create") {
      const movementType = clean(p.movementType).toUpperCase();
      const warehouseId = await ownedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const targetWarehouseId = movementType === "MM" ? await ownedId("warehouses", p.targetWarehouseId, workspace.id, "Magazyn docelowy") : null;
      const projectId = await ownedId("projects", p.projectId, workspace.id, "Inwestycja", true);
      const counterpartyId = await ownedId("counterparties", p.counterpartyId, workspace.id, "Kontrahent", true);
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const { data, error } = await db.rpc("create_stock_movement_draft_v2_atomic", {
        p_workspace_id: workspace.id,
        p_movement_type: movementType,
        p_warehouse_id: warehouseId,
        p_target_warehouse_id: targetWarehouseId,
        p_destination_mode: nullable(p.destinationMode),
        p_project_id: projectId,
        p_counterparty_id: counterpartyId,
        p_document_number: nullable(p.documentNumber),
        p_movement_date: validDate(p.movementDate),
        p_lines: lines,
        p_actor_id: user.id
      });
      if (error || !data) throw new Error(error?.message ?? "Nie udało się utworzyć szkicu ruchu.");
      return NextResponse.json({ ok: true, id: String(data), status: "draft" });
    }

    return NextResponse.json({ error: "Nieobsługiwana operacja." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja ruchu magazynowego nie powiodła się." }, { status: 400 });
  }
}
