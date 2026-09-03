import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "match" | "create" | "non_stock" | "ignore_document" | "rename_item" | "undo" | "finalize_review";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

type AiLine = {
  id: string; workspace_id: string; review_id: string; document_id: string; document_version_id: string;
  raw_description: string; normalized_description: string; line_class: string; quantity: number | null; unit: string | null;
  unit_price: number | null; normalized_unit_price: number | null; currency: string | null; supplier_sku: string | null;
  manufacturer: string | null; model: string | null; ean: string | null; candidate_stock_item_id: string | null;
  match_confidence: number; decision: string; decision_reason: string | null; human_corrected: boolean;
};

type Review = {
  id: string; workspace_id: string; supplier_name: string | null; supplier_tax_id: string | null;
  document_date: string | null; draft_movement_id: string | null; status: string;
};

type DecisionEvent = {
  id: string; ai_line_id: string; before_decision: string; before_candidate_stock_item_id: string | null;
  before_match_confidence: number | null; before_reason: string | null; after_decision: string;
  after_candidate_stock_item_id: string | null; reverted_at: string | null;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function loadLine(workspaceId: string, lineId: unknown) {
  const id = clean(lineId);
  if (!id) throw new Error("Nie wskazano pozycji Poczekalni.");
  const db = createServiceSupabaseClient();
  const { data: line, error } = await db.from("warehouse_ai_lines")
    .select("id,workspace_id,review_id,document_id,document_version_id,raw_description,normalized_description,line_class,quantity,unit,unit_price,normalized_unit_price,currency,supplier_sku,manufacturer,model,ean,candidate_stock_item_id,match_confidence,decision,decision_reason,human_corrected")
    .eq("workspace_id", workspaceId).eq("id", id).maybeSingle<AiLine>();
  if (error || !line) throw new Error("Pozycja Poczekalni nie należy do aktywnej firmy.");
  const { data: review, error: reviewError } = await db.from("warehouse_document_reviews")
    .select("id,workspace_id,supplier_name,supplier_tax_id,document_date,draft_movement_id,status")
    .eq("workspace_id", workspaceId).eq("id", line.review_id).maybeSingle<Review>();
  if (reviewError || !review) throw new Error("Nie znaleziono dokumentu źródłowego pozycji.");
  return { line, review };
}

async function normalizeKey(value: string) {
  if (!value) return "";
  const db = createServiceSupabaseClient();
  const { data } = await db.rpc("normalize_material_key", { p_value: value });
  return String(data ?? value.toLocaleLowerCase("pl")).trim();
}

async function counterpartyIdForReview(workspaceId: string, review: Review) {
  const db = createServiceSupabaseClient();
  if (review.supplier_tax_id) {
    const { data } = await db.from("counterparties").select("id").eq("workspace_id", workspaceId).eq("tax_id", review.supplier_tax_id).limit(1).maybeSingle<{ id: string }>();
    if (data?.id) return data.id;
  }
  if (review.supplier_name) {
    const supplierKey = await normalizeKey(review.supplier_name);
    const { data } = await db.from("counterparties").select("id,name").eq("workspace_id", workspaceId).eq("active", true).limit(500).returns<Array<{ id: string; name: string }>>();
    return data?.find((row) => row.name && row.name.length && row.name.toLocaleLowerCase("pl") === review.supplier_name?.toLocaleLowerCase("pl"))?.id
      ?? data?.find(async (row) => await normalizeKey(row.name) === supplierKey)?.id
      ?? null;
  }
  return null;
}

async function learnAlias(input: { workspaceId: string; stockItemId: string; line: AiLine; review: Review; userId: string }) {
  const db = createServiceSupabaseClient();
  const normalized = input.line.normalized_description || await normalizeKey(input.line.raw_description);
  const counterpartyId = await counterpartyIdForReview(input.workspaceId, input.review);
  let query = db.from("material_aliases").select("id,stock_item_id").eq("workspace_id", input.workspaceId).eq("normalized_key", normalized);
  if (input.line.supplier_sku) query = query.eq("supplier_sku", input.line.supplier_sku);
  const { data: candidates } = await query.limit(20).returns<Array<{ id: string; stock_item_id: string }>>();
  const existing = candidates?.[0];
  const payload = {
    stock_item_id: input.stockItemId,
    counterparty_id: counterpartyId,
    supplier_sku: input.line.supplier_sku,
    supplier_name: input.review.supplier_name,
    confidence: 1,
    status: "approved"
  };
  if (existing) {
    const { error } = await db.from("material_aliases").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Nie udało się nauczyć aliasu: ${error.message}`);
  } else {
    const { error } = await db.from("material_aliases").insert({ ...payload, workspace_id: input.workspaceId, normalized_key: normalized, created_by: input.userId });
    if (error && error.code !== "23505") throw new Error(`Nie udało się nauczyć aliasu: ${error.message}`);
  }
}

async function recordFeedback(input: { workspaceId: string; line: AiLine; review: Review; candidateId: string; feedback: "accepted" | "rejected"; userId: string }) {
  const db = createServiceSupabaseClient();
  const supplierKey = await normalizeKey(input.review.supplier_name ?? "");
  const normalized = input.line.normalized_description || await normalizeKey(input.line.raw_description);
  const { data: existing } = await db.from("warehouse_ai_feedback")
    .select("id,hit_count").eq("workspace_id", input.workspaceId).eq("normalized_description", normalized)
    .eq("supplier_key", supplierKey).eq("candidate_stock_item_id", input.candidateId).eq("feedback", input.feedback)
    .maybeSingle<{ id: string; hit_count: number }>();
  if (existing) {
    await db.from("warehouse_ai_feedback").update({ hit_count: Number(existing.hit_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await db.from("warehouse_ai_feedback").insert({ workspace_id: input.workspaceId, normalized_description: normalized, supplier_key: supplierKey, supplier_sku: input.line.supplier_sku, candidate_stock_item_id: input.candidateId, feedback: input.feedback, hit_count: 1, created_by: input.userId });
  }
}

async function recordEvent(workspaceId: string, line: AiLine, afterDecision: string, afterCandidateId: string | null, userId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("warehouse_ai_decision_events").insert({
    workspace_id: workspaceId, ai_line_id: line.id, before_decision: line.decision,
    before_candidate_stock_item_id: line.candidate_stock_item_id, before_match_confidence: line.match_confidence,
    before_reason: line.decision_reason, after_decision: afterDecision, after_candidate_stock_item_id: afterCandidateId,
    created_by: userId
  }).select("id").single<{ id: string }>();
  if (error || !data) throw new Error(`Nie udało się zapisać historii decyzji: ${error?.message ?? "brak danych"}`);
  return data.id;
}

async function finalizeReview(workspaceId: string, reviewId: string, userId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("finalize_warehouse_review_atomic", { p_workspace_id: workspaceId, p_review_id: reviewId, p_actor_id: userId });
  if (error) throw new Error(`Pozycję zapisano, ale nie udało się przygotować szkicu ruchu: ${error.message}`);
  return data ? String(data) : null;
}

async function removeDraftIfStillEditable(workspaceId: string, review: Review) {
  if (!review.draft_movement_id) return;
  const db = createServiceSupabaseClient();
  const { data: movement } = await db.from("stock_movements").select("id,status,source_group_key").eq("workspace_id", workspaceId).eq("id", review.draft_movement_id).maybeSingle<{ id: string; status: string; source_group_key: string | null }>();
  if (movement?.status === "draft" && movement.source_group_key === "warehouse-ai-31") {
    await db.from("stock_movement_lines").delete().eq("workspace_id", workspaceId).eq("movement_id", movement.id);
    await db.from("stock_movements").delete().eq("workspace_id", workspaceId).eq("id", movement.id);
    await db.from("warehouse_document_reviews").update({ draft_movement_id: null, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", review.id);
  }
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
      const eventId = await recordEvent(workspaceId, line, "matched", stockItemId, user.id);
      if (line.candidate_stock_item_id && line.candidate_stock_item_id !== stockItemId) {
        await recordFeedback({ workspaceId, line, review, candidateId: line.candidate_stock_item_id, feedback: "rejected", userId: user.id });
      }
      const { error } = await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: stockItemId, match_confidence: 1, decision: "matched",
        decision_reason: "Pozycję potwierdzono ręcznie. Octopus zapamięta tę decyzję dla kolejnych dokumentów.",
        human_corrected: line.candidate_stock_item_id !== stockItemId || line.decision !== "auto_matched",
        decided_by: user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      if (error) throw new Error(error.message);
      await recordFeedback({ workspaceId, line, review, candidateId: stockItemId, feedback: "accepted", userId: user.id });
      await learnAlias({ workspaceId, stockItemId, line, review, userId: user.id });
      const movementId = await finalizeReview(workspaceId, review.id, user.id);
      return NextResponse.json({ ok: true, decision: "matched", stockItemId, eventId, movementId });
    }

    if (body.action === "create") {
      const { line, review } = await loadLine(workspaceId, body.payload.lineId);
      const name = clean(body.payload.name) || line.raw_description;
      const unit = clean(body.payload.unit) || line.unit || "szt.";
      const itemType = ["device", "tool"].includes(line.line_class) ? "equipment" : "material";
      const { data: exactName } = await db.from("stock_items").select("id,name").eq("workspace_id", workspaceId).eq("active", true).ilike("name", name).limit(1).maybeSingle<{ id: string; name: string }>();
      if (exactName && !body.payload.force) {
        return NextResponse.json({ error: `Istnieje już bardzo podobna kartoteka „${exactName.name}”. Połącz pozycję albo wybierz „Utwórz mimo to”.`, duplicateId: exactName.id }, { status: 409 });
      }
      const { data: created, error: createError } = await db.from("stock_items").insert({
        workspace_id: workspaceId, name, sku: line.supplier_sku || null, item_type: itemType, unit,
        serial_tracking: ["device", "tool"].includes(line.line_class), active: true, category: line.line_class,
        manufacturer: line.manufacturer, model: line.model, barcode: line.ean
      }).select("id").single<{ id: string }>();
      if (createError || !created) throw new Error(createError?.code === "23505" ? "SKU lub EAN jest już używany. Najpierw połącz z istniejącą kartoteką." : `Nie udało się utworzyć kartoteki: ${createError?.message ?? "brak danych"}`);
      const eventId = await recordEvent(workspaceId, line, "new_item_created", created.id, user.id);
      if (line.candidate_stock_item_id) await recordFeedback({ workspaceId, line, review, candidateId: line.candidate_stock_item_id, feedback: "rejected", userId: user.id });
      const { error } = await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: created.id, match_confidence: 1, decision: "new_item_created",
        decision_reason: "Utworzono nową kartotekę na podstawie pozycji dokumentu.", human_corrected: true,
        decided_by: user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      if (error) throw new Error(error.message);
      await recordFeedback({ workspaceId, line, review, candidateId: created.id, feedback: "accepted", userId: user.id });
      await learnAlias({ workspaceId, stockItemId: created.id, line, review, userId: user.id });
      const movementId = await finalizeReview(workspaceId, review.id, user.id);
      return NextResponse.json({ ok: true, decision: "new_item_created", stockItemId: created.id, eventId, movementId });
    }

    if (body.action === "non_stock") {
      const { line, review } = await loadLine(workspaceId, body.payload.lineId);
      const eventId = await recordEvent(workspaceId, line, "non_stock", null, user.id);
      if (line.candidate_stock_item_id) await recordFeedback({ workspaceId, line, review, candidateId: line.candidate_stock_item_id, feedback: "rejected", userId: user.id });
      const { error } = await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: null, match_confidence: 1, decision: "non_stock",
        decision_reason: "Użytkownik potwierdził, że pozycja nie jest zapasem magazynowym.", human_corrected: true,
        decided_by: user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      if (error) throw new Error(error.message);
      const movementId = await finalizeReview(workspaceId, review.id, user.id);
      return NextResponse.json({ ok: true, decision: "non_stock", eventId, movementId });
    }

    if (body.action === "ignore_document") {
      const reviewId = clean(body.payload.reviewId);
      if (!reviewId) throw new Error("Nie wskazano dokumentu Poczekalni.");
      const { data: review } = await db.from("warehouse_document_reviews").select("id,workspace_id,supplier_name,supplier_tax_id,document_date,draft_movement_id,status").eq("workspace_id", workspaceId).eq("id", reviewId).maybeSingle<Review>();
      if (!review) throw new Error("Dokument nie należy do aktywnej firmy.");
      await removeDraftIfStillEditable(workspaceId, review);
      const { error: lineError } = await db.from("warehouse_ai_lines").update({
        decision: "rejected", human_corrected: true, decided_by: user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("review_id", reviewId).in("decision", ["needs_review", "new_item_proposed"]);
      if (lineError) throw new Error(lineError.message);
      const { error } = await db.from("warehouse_document_reviews").update({ status: "ignored", draft_movement_id: null, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", reviewId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, decision: "ignored" });
    }

    if (body.action === "undo") {
      const eventId = clean(body.payload.eventId);
      if (!eventId) throw new Error("Nie wskazano decyzji do cofnięcia.");
      const { data: event, error: eventError } = await db.from("warehouse_ai_decision_events")
        .select("id,ai_line_id,before_decision,before_candidate_stock_item_id,before_match_confidence,before_reason,after_decision,after_candidate_stock_item_id,reverted_at")
        .eq("workspace_id", workspaceId).eq("id", eventId).maybeSingle<DecisionEvent>();
      if (eventError || !event || event.reverted_at) throw new Error("Ta decyzja nie może już zostać cofnięta.");
      const { line, review } = await loadLine(workspaceId, event.ai_line_id);
      await removeDraftIfStillEditable(workspaceId, review);
      const { error } = await db.from("warehouse_ai_lines").update({
        candidate_stock_item_id: event.before_candidate_stock_item_id,
        match_confidence: event.before_match_confidence ?? 0,
        decision: event.before_decision,
        decision_reason: event.before_reason,
        human_corrected: true,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("workspace_id", workspaceId).eq("id", line.id);
      if (error) throw new Error(error.message);
      await db.from("warehouse_ai_decision_events").update({ reverted_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", event.id);
      return NextResponse.json({ ok: true, decision: event.before_decision });
    }

    if (body.action === "finalize_review") {
      const reviewId = clean(body.payload.reviewId);
      if (!reviewId) throw new Error("Nie wskazano dokumentu.");
      const movementId = await finalizeReview(workspaceId, reviewId, user.id);
      return NextResponse.json({ ok: true, movementId });
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
