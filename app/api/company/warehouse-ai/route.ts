import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "match" | "create" | "non_stock" | "ignore_document" | "rename_item";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

type AiLine = {
  id: string;
  workspace_id: string;
  review_id: string;
  document_id: string;
  document_version_id: string;
  raw_description: string;
  normalized_description: string;
  line_class: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  currency: string | null;
  supplier_sku: string | null;
};

type Review = {
  id: string;
  workspace_id: string;
  supplier_name: string | null;
  supplier_tax_id: string | null;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function loadLine(workspaceId: string, lineId: unknown) {
  const id = clean(lineId);
  if (!id) throw new Error("Nie wskazano pozycji Poczekalni.");
  const db = createServiceSupabaseClient();
  const { data: line, error } = await db.from("warehouse_ai_lines")
    .select("id,workspace_id,review_id,document_id,document_version_id,raw_description,normalized_description,line_class,quantity,unit,unit_price,currency,supplier_sku")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle<AiLine>();
  if (error || !line) throw new Error("Pozycja Poczekalni nie należy do aktywnej firmy.");
  const { data: review, error: reviewError } = await db.from("warehouse_document_reviews")
    .select("id,workspace_id,supplier_name,supplier_tax_id")
    .eq("workspace_id", workspaceId)
    .eq("id", line.review_id)
    .maybeSingle<Review>();
  if (reviewError || !review) throw new Error("Nie znaleziono dokumentu źródłowego pozycji.");
  return { line, review };
}

async function learnAlias(input: {
  workspaceId: string;
  stockItemId: string;
  line: AiLine;
  review: Review;
  userId: string;
}) {
  const db = createServiceSupabaseClient();
  const normalized = input.line.normalized_description || input.line.raw_description.toLocaleLowerCase("pl").replace(/[^a-z0-9ąćęłńóśźż]+/gi, "-").replace(/^-|-$/g, "");
  const { data: existing } = await db.from("material_aliases")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("stock_item_id", input.stockItemId)
    .eq("normalized_key", normalized)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) {
    await db.from("material_aliases").update({
      supplier_sku: input.line.supplier_sku,
      supplier_name: input.review.supplier_name,
      confidence: 1,
      status: "approved"
    }).eq("id", existing.id);
  } else {
    await db.from("material_aliases").insert({
      workspace_id: input.workspaceId,
      stock_item_id: input.stockItemId,
      supplier_sku: input.line.supplier_sku,
      supplier_name: input.review.supplier_name,
      normalized_key: normalized,
      confidence: 1,
      status: "approved",
      created_by: input.userId
    });
  }
}

async function recordObservedPrice(input: { workspaceId: string; stockItemId: string; line: AiLine; review: Review }) {
  if (!input.line.unit_price || input.line.unit_price <= 0) return;
  const db = createServiceSupabaseClient();
  let counterpartyId: string | null = null;
  if (input.review.supplier_tax_id) {
    const { data } = await db.from("counterparties")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("tax_id", input.review.supplier_tax_id)
      .limit(1)
      .maybeSingle<{ id: string }>();
    counterpartyId = data?.id ?? null;
  }
  if (!counterpartyId && input.review.supplier_name) {
    const { data } = await db.from("counterparties")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .ilike("name", input.review.supplier_name)
      .limit(1)
      .maybeSingle<{ id: string }>();
    counterpartyId = data?.id ?? null;
  }
  await db.from("price_observations").upsert({
    workspace_id: input.workspaceId,
    stock_item_id: input.stockItemId,
    counterparty_id: counterpartyId,
    source_type: "warehouse_ai_line",
    source_id: input.line.id,
    observed_at: new Date().toISOString().slice(0, 10),
    quantity: input.line.quantity,
    unit: input.line.unit,
    unit_price_net: input.line.unit_price,
    currency: input.line.currency || "PLN",
    price_stage: "document_ai",
    canonical_purchase: false
  }, { onConflict: "workspace_id,source_type,source_id" });
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

  const workspaceId = clean(body.workspaceId);
  if (!workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain: "warehouse", level: "write" })) {
    return NextResponse.json({ error: "Brak uprawnienia do edycji Magazynu." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  try {
    if (body.action === "match") {
      const { line, review } = await loadLine(workspaceId, body.payload.lineId);
      const stockItemId = clean(body.payload.stockItemId);
      if (!stockItemId) throw new Error("Wybierz kartotekę, z którą połączyć pozycję.");
      const { data: stockItem } = await db.from("stock_items").select("id").eq("workspace_id", workspaceId).eq("id", stockItemId).eq("active", true).maybeSingle<{ id: string }>();
      if (!stockItem) throw new Error("Wybrana kartoteka nie należy do aktywnej firmy.");
      await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: stockItemId,
        match_confidence: 1,
        decision: "matched",
        decision_reason: "Pozycję potwierdzono ręcznie i zapisano jako wyuczony alias dostawcy.",
        human_corrected: true,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      await learnAlias({ workspaceId, stockItemId, line, review, userId: user.id });
      await recordObservedPrice({ workspaceId, stockItemId, line, review });
      return NextResponse.json({ ok: true, decision: "matched", stockItemId });
    }

    if (body.action === "create") {
      const { line, review } = await loadLine(workspaceId, body.payload.lineId);
      const name = clean(body.payload.name) || line.raw_description;
      const unit = clean(body.payload.unit) || line.unit || "szt.";
      const itemType = ["device", "tool"].includes(line.line_class) ? "equipment" : "material";
      const { data: created, error: createError } = await db.from("stock_items").insert({
        workspace_id: workspaceId,
        name,
        sku: line.supplier_sku || null,
        item_type: itemType,
        unit,
        serial_tracking: ["device", "tool"].includes(line.line_class),
        active: true,
        category: line.line_class
      }).select("id").single<{ id: string }>();
      if (createError || !created) throw new Error(`Nie udało się utworzyć kartoteki: ${createError?.message ?? "brak danych"}`);
      await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: created.id,
        match_confidence: 1,
        decision: "new_item_created",
        decision_reason: "Utworzono nową kartotekę na podstawie propozycji AI.",
        human_corrected: true,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      await learnAlias({ workspaceId, stockItemId: created.id, line, review, userId: user.id });
      await recordObservedPrice({ workspaceId, stockItemId: created.id, line, review });
      return NextResponse.json({ ok: true, decision: "new_item_created", stockItemId: created.id });
    }

    if (body.action === "non_stock") {
      const { line } = await loadLine(workspaceId, body.payload.lineId);
      await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: null,
        match_confidence: 1,
        decision: "non_stock",
        decision_reason: "Użytkownik potwierdził, że pozycja nie jest zapasem magazynowym.",
        human_corrected: true,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      return NextResponse.json({ ok: true, decision: "non_stock" });
    }

    if (body.action === "ignore_document") {
      const reviewId = clean(body.payload.reviewId);
      if (!reviewId) throw new Error("Nie wskazano dokumentu Poczekalni.");
      const { data: review } = await db.from("warehouse_document_reviews").select("id").eq("workspace_id", workspaceId).eq("id", reviewId).maybeSingle<{ id: string }>();
      if (!review) throw new Error("Dokument nie należy do aktywnej firmy.");
      await db.from("warehouse_ai_lines").update({
        decision: "rejected",
        human_corrected: true,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("review_id", reviewId).in("decision", ["needs_review", "new_item_proposed"]);
      await db.from("warehouse_document_reviews").update({ status: "ignored", updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", reviewId);
      return NextResponse.json({ ok: true, decision: "ignored" });
    }

    if (body.action === "rename_item") {
      const stockItemId = clean(body.payload.stockItemId);
      const name = clean(body.payload.name);
      if (!stockItemId || !name) throw new Error("Uzupełnij nazwę kartoteki.");
      const { data: updated, error } = await db.from("stock_items").update({ name, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId).eq("id", stockItemId).select("id").maybeSingle<{ id: string }>();
      if (error || !updated) throw new Error("Nie udało się zmienić nazwy kartoteki.");
      return NextResponse.json({ ok: true, stockItemId, name });
    }

    return NextResponse.json({ error: "Nieobsługiwana operacja Warehouse AI." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja Warehouse AI nie powiodła się." }, { status: 422 });
  }
}
