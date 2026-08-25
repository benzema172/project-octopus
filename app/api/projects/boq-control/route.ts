import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type AccessLevel, type Domain } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "create_revision" | "save_item" | "remove_item" | "submit_version" | "approve_version" | "upsert_wbs" | "create_change_order" | "transition_change_order";

type Body = {
  projectId?: string;
  action?: Action;
  versionId?: string;
  basedOnVersionId?: string;
  itemId?: string;
  name?: string;
  revisionKind?: string;
  changeOrderId?: string;
  itemNumber?: string;
  description?: string;
  unit?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  wbsNodeId?: string;
  costCode?: string;
  revisionNote?: string;
  parentId?: string;
  code?: string;
  branch?: string;
  installation?: string;
  zone?: string;
  sortOrder?: string | number;
  number?: string;
  title?: string;
  valueChange?: string | number;
  daysChange?: string | number;
  transition?: "submit" | "approve" | "reject" | "reopen";
  note?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalId(value: unknown) {
  return clean(value) || null;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return parseLocalizedNumber(value);
}

function requiredAccess(body: Body): { domain: Domain; level: AccessLevel } {
  if (body.action === "approve_version") return { domain: "investments", level: "approve" };
  if (body.action === "create_change_order") return { domain: "finance", level: "write" };
  if (body.action === "transition_change_order") {
    return { domain: "finance", level: body.transition === "approve" || body.transition === "reject" ? "approve" : "write" };
  }
  return { domain: "investments", level: "write" };
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nieprawidłowe dane operacji." }, { status: error instanceof JsonBodyError ? error.status : 400 });
  }

  if (!body.projectId || !body.action) return NextResponse.json({ error: "Brakuje inwestycji lub rodzaju operacji." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  const access = requiredAccess(body);
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: access.domain, level: access.level, projectId: project.id })) {
    return NextResponse.json({ error: `Brak uprawnienia ${access.level} w domenie ${access.domain}.` }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const common = { p_workspace_id: project.workspace_id, p_project_id: project.id, p_actor_id: user.id };
  try {
    if (body.action === "create_revision") {
      const { data, error } = await db.rpc("create_boq_revision_atomic", {
        ...common,
        p_based_on_version_id: optionalId(body.basedOnVersionId),
        p_name: clean(body.name),
        p_revision_kind: clean(body.revisionKind) || "revision",
        p_change_order_id: optionalId(body.changeOrderId)
      }).single<{ result_version_id: string; result_version_number: number; result_item_count: number }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się utworzyć rewizji BOQ.");
      return NextResponse.json({ ok: true, versionId: data.result_version_id, versionNumber: data.result_version_number, itemCount: data.result_item_count });
    }

    if (body.action === "save_item") {
      const { data, error } = await db.rpc("save_boq_revision_item_atomic", {
        ...common,
        p_boq_version_id: clean(body.versionId),
        p_item_id: optionalId(body.itemId),
        p_item_number: clean(body.itemNumber),
        p_description: clean(body.description),
        p_unit: clean(body.unit),
        p_quantity: optionalNumber(body.quantity),
        p_unit_price: optionalNumber(body.unitPrice),
        p_wbs_node_id: optionalId(body.wbsNodeId),
        p_cost_code: clean(body.costCode),
        p_change_order_id: optionalId(body.changeOrderId),
        p_revision_note: clean(body.revisionNote)
      }).single<{ result_item_id: string; result_total_price: number; result_change_type: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się zapisać pozycji BOQ.");
      return NextResponse.json({ ok: true, itemId: data.result_item_id, totalPrice: data.result_total_price, changeType: data.result_change_type });
    }

    if (body.action === "remove_item") {
      const { data, error } = await db.rpc("remove_boq_revision_item_atomic", {
        ...common, p_boq_version_id: clean(body.versionId), p_item_id: clean(body.itemId)
      }).single<{ result_item_id: string; result_change_type: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się usunąć pozycji BOQ.");
      return NextResponse.json({ ok: true, itemId: data.result_item_id, changeType: data.result_change_type });
    }

    if (body.action === "submit_version") {
      const { data, error } = await db.rpc("submit_boq_version_atomic", { ...common, p_boq_version_id: clean(body.versionId) })
        .single<{ result_version_id: string; result_status: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się przekazać wersji do akceptacji.");
      return NextResponse.json({ ok: true, versionId: data.result_version_id, status: data.result_status });
    }

    if (body.action === "approve_version") {
      const { data, error } = await db.rpc("approve_boq_version_atomic", {
        ...common, p_boq_version_id: clean(body.versionId), p_note: clean(body.note) || null
      }).single<{ result_version_id: string; result_status: string; result_net_value: number; result_active_items: number }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się zatwierdzić wersji BOQ.");
      return NextResponse.json({ ok: true, versionId: data.result_version_id, status: data.result_status, netValue: data.result_net_value, activeItems: data.result_active_items });
    }

    if (body.action === "upsert_wbs") {
      const { data, error } = await db.rpc("upsert_wbs_node_atomic", {
        ...common,
        p_wbs_node_id: optionalId(body.wbsNodeId),
        p_parent_id: optionalId(body.parentId),
        p_code: clean(body.code),
        p_name: clean(body.name),
        p_branch: clean(body.branch),
        p_installation: clean(body.installation),
        p_zone: clean(body.zone),
        p_sort_order: Math.round(parseLocalizedNumber(body.sortOrder))
      }).single<{ result_wbs_node_id: string; result_status: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się zapisać elementu WBS.");
      return NextResponse.json({ ok: true, wbsNodeId: data.result_wbs_node_id, status: data.result_status });
    }

    if (body.action === "create_change_order") {
      const { data, error } = await db.rpc("create_change_order_controlled_atomic", {
        ...common,
        p_number: clean(body.number),
        p_title: clean(body.title),
        p_description: clean(body.description),
        p_value_change: optionalNumber(body.valueChange),
        p_days_change: Math.round(parseLocalizedNumber(body.daysChange))
      }).single<{ result_change_order_id: string; result_status: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się utworzyć Change Order.");
      return NextResponse.json({ ok: true, changeOrderId: data.result_change_order_id, status: data.result_status });
    }

    if (!body.transition) return NextResponse.json({ error: "Brakuje przejścia statusu Change Order." }, { status: 400 });
    const { data, error } = await db.rpc("review_change_order_atomic", {
      ...common,
      p_change_order_id: clean(body.changeOrderId),
      p_action: body.transition,
      p_note: clean(body.note) || null
    }).single<{ result_change_order_id: string; result_status: string }>();
    if (error || !data) throw new Error(error?.message ?? "Nie udało się zmienić statusu Change Order.");
    return NextResponse.json({ ok: true, changeOrderId: data.result_change_order_id, status: data.result_status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operacja kontroli BOQ nie powiodła się.";
    const conflict = /only|must|transition|already|duplicate|submitted|approved|draft/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 422 });
  }
}
