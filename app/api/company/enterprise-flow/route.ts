import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action =
  | "accounting_approve"
  | "procurement_refresh"
  | "procurement_approve"
  | "invoice_line_allocate"
  | "document_orchestrate"
  | "deviation_close"
  | "business_inbox_upsert";

type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result || null;
}

function numeric(value: unknown, label: string) {
  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return parsed;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 }); }
  if (!body.workspaceId || !body.action) return NextResponse.json({ error: "Brakuje firmy lub operacji." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const db = createServiceSupabaseClient();
  const p = body.payload ?? {};

  const requireFinance = async (level: "write" | "approve" = "write") => {
    if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level })) {
      throw new Error(level === "approve" ? "Brak uprawnienia do zatwierdzania finansów." : "Brak uprawnienia do zmiany danych finansowych.");
    }
  };

  try {
    if (body.action === "accounting_approve") {
      await requireFinance("approve");
      const entryId = text(p.entryId, "dekret", true)!;
      const { data, error } = await db.rpc("approve_accounting_entry_atomic", { p_workspace_id: workspace.id, p_entry_id: entryId, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: data });
    }

    if (body.action === "procurement_refresh") {
      await requireFinance();
      const invoiceId = text(p.invoiceId, "faktura", true)!;
      const { data, error } = await db.rpc("refresh_procurement_matches_for_invoice_atomic", { p_workspace_id: workspace.id, p_invoice_id: invoiceId, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, processed: data });
    }

    if (body.action === "procurement_approve") {
      await requireFinance("approve");
      const matchId = text(p.matchId, "uzgodnienie", true)!;
      const { data, error } = await db.rpc("approve_procurement_match_atomic", { p_workspace_id: workspace.id, p_match_id: matchId, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: data });
    }

    if (body.action === "invoice_line_allocate") {
      await requireFinance();
      const lineId = text(p.invoiceLineId, "pozycja faktury", true)!;
      const projectId = text(p.projectId, "inwestycja", true)!;
      if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "write", projectId })) {
        throw new Error("Brak uprawnienia do przypisania kosztu do tej inwestycji.");
      }
      const { data, error } = await db.rpc("set_invoice_line_allocation_atomic", {
        p_workspace_id: workspace.id,
        p_invoice_line_id: lineId,
        p_project_id: projectId,
        p_boq_item_id: text(p.boqItemId, "BOQ"),
        p_wbs_node_id: text(p.wbsNodeId, "WBS"),
        p_cost_code: text(p.costCode, "kod kosztu") ?? "",
        p_amount: numeric(p.amount, "kwota netto"),
        p_actor_id: user.id
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: data });
    }

    if (body.action === "document_orchestrate") {
      await requireFinance();
      const documentId = text(p.documentId, "dokument", true)!;
      const { data: document } = await db.from("documents").select("id,review_status").eq("workspace_id", workspace.id).eq("id", documentId).maybeSingle<{ id: string; review_status: string }>();
      if (!document) throw new Error("Dokument nie należy do firmy.");
      if (document.review_status !== "approved") throw new Error("Automaty biznesowe można uruchomić dopiero po zatwierdzeniu dokumentu.");
      const { data, error } = await db.rpc("orchestrate_approved_business_document_atomic", { p_workspace_id: workspace.id, p_document_id: documentId, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, result: data });
    }

    if (body.action === "deviation_close") {
      await requireFinance();
      const deviationId = text(p.deviationId, "odstępstwo", true)!;
      const resolution = text(p.resolution, "uzasadnienie", true)!;
      const { data: deviation } = await db.from("process_deviations").select("id,project_id,status").eq("workspace_id", workspace.id).eq("id", deviationId).maybeSingle<{ id: string; project_id: string | null; status: string }>();
      if (!deviation) throw new Error("Odstępstwo nie należy do firmy.");
      if (deviation.project_id && !await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "write", projectId: deviation.project_id })) {
        throw new Error("Brak uprawnienia do zamknięcia odstępstwa tej inwestycji.");
      }
      const { error } = await db.from("process_deviations").update({ status: "closed", resolution_note: resolution, closed_by: user.id, closed_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", deviationId);
      if (error) throw new Error(error.message);
      await db.from("audit_events").insert({ workspace_id: workspace.id, project_id: deviation.project_id, actor_id: user.id, event_type: "process_deviation.closed", entity_type: "process_deviation", entity_id: deviationId, after_value: { resolution } });
      return NextResponse.json({ ok: true, id: deviationId });
    }

    await requireFinance();
    const sourceChannel = text(p.sourceChannel, "kanał", true)!;
    const externalKey = text(p.externalKey, "identyfikator zewnętrzny", true)!;
    const allowedChannels = new Set(["ksef", "erp", "subiekt", "comarch", "symfonia", "enova", "email", "api", "upload"]);
    if (!allowedChannels.has(sourceChannel.toLowerCase())) throw new Error("Nieobsługiwany kanał źródłowy.");
    const projectId = text(p.projectId, "inwestycja");
    const documentId = text(p.documentId, "dokument");
    if (projectId && !await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "write", projectId })) throw new Error("Brak dostępu do wskazanej inwestycji.");
    if (documentId) {
      const { data: doc } = await db.from("documents").select("id").eq("workspace_id", workspace.id).eq("id", documentId).maybeSingle();
      if (!doc) throw new Error("Dokument nie należy do firmy.");
    }
    const { data, error } = await db.from("business_inbox_items").upsert({
      workspace_id: workspace.id,
      source_channel: sourceChannel.toLowerCase(),
      external_key: externalKey,
      document_id: documentId,
      project_id: projectId,
      document_type: text(p.documentType, "typ dokumentu"),
      status: documentId ? "processing" : "new",
      payload: p.payload && typeof p.payload === "object" ? p.payload : {}
    }, { onConflict: "workspace_id,source_channel,external_key" }).select("id").single<{ id: string }>();
    if (error || !data) throw new Error(error?.message ?? "Nie utworzono elementu Inbox.");
    return NextResponse.json({ ok: true, id: data.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja nie powiodła się." }, { status: 422 });
  }
}
