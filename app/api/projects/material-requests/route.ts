import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  action?: "save" | "review" | "send" | "approve" | "reject";
  requestId?: string | null;
  sourceRequirementId?: string | null;
  title?: string;
  manufacturer?: string;
  productName?: string;
  model?: string;
  proposedUse?: string;
  complianceSummary?: string;
  stockItemId?: string | null;
  boqItemId?: string | null;
  wbsNodeId?: string | null;
  requestOrigin?: "planned" | "retroactive";
  sentTo?: string;
  note?: string;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane wniosku." }, { status: 400 }); }
  if (!body.projectId || !body.action) return NextResponse.json({ error: "Brakuje inwestycji lub operacji." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })) return NextResponse.json({ error: "Brak uprawnienia do zapisu wniosków." }, { status: 403 });
  const db = createServiceSupabaseClient();
  try {
    if (body.action === "save") {
      const { data, error } = await db.rpc("save_material_request_v2_atomic", {
        p_workspace_id: project.workspace_id,
        p_project_id: project.id,
        p_request_id: nullable(body.requestId),
        p_source_requirement_id: nullable(body.sourceRequirementId),
        p_title: clean(body.title),
        p_manufacturer: clean(body.manufacturer),
        p_product_name: clean(body.productName),
        p_model: clean(body.model),
        p_proposed_use: clean(body.proposedUse),
        p_compliance_summary: clean(body.complianceSummary),
        p_stock_item_id: nullable(body.stockItemId),
        p_boq_item_id: nullable(body.boqItemId),
        p_wbs_node_id: nullable(body.wbsNodeId),
        p_request_origin: body.requestOrigin === "retroactive" ? "retroactive" : "planned",
        p_actor_id: user.id
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: data, status: "draft" });
    }
    if (!body.requestId) throw new Error("Brakuje identyfikatora wniosku.");
    const { data, error } = await db.rpc("transition_material_request_atomic", {
      p_workspace_id: project.workspace_id,
      p_project_id: project.id,
      p_request_id: body.requestId,
      p_action: body.action,
      p_sent_to: clean(body.sentTo),
      p_note: clean(body.note),
      p_actor_id: user.id
    }).single<{ result_id: string; result_status: string }>();
    if (error || !data) throw new Error(error?.message ?? "Brak wyniku workflow.");
    return NextResponse.json({ ok: true, id: data.result_id, status: data.result_status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się wykonać operacji wniosku." }, { status: 400 });
  }
}