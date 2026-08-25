import "server-only";

import { buildBoqVersionDiff, type BoqControlItem } from "@/lib/boq-version-diff";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export { buildBoqVersionDiff } from "@/lib/boq-version-diff";
export type { BoqControlItem, BoqVersionDiff, BoqVersionDiffRow } from "@/lib/boq-version-diff";

export type BoqControlVersion = {
  id: string;
  versionNumber: number;
  name: string;
  status: string;
  currency: string;
  netValue: number;
  validFrom: string | null;
  basedOnVersionId: string | null;
  changeOrderId: string | null;
  revisionKind: string;
  notes: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WbsControlNode = {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  branch: string | null;
  installation: string | null;
  zone: string | null;
  sortOrder: number;
  status: string;
};

export type ChangeOrderControlItem = {
  id: string;
  number: string | null;
  title: string;
  description: string | null;
  status: string;
  valueChange: number;
  daysChange: number;
  impactSummary: Record<string, unknown>;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  approvedBoqVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbRow = Record<string, unknown>;
type QueryResult = { data: DbRow[] | null; error: { message: string } | null };

const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nullableNumber = (value: unknown) => value === null || value === undefined ? null : number(value);
const text = (value: unknown) => typeof value === "string" && value.length ? value : null;

function rows(result: QueryResult, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label}: ${result.error.message}`);
  return result.data ?? [];
}

export async function getProjectBoqControl(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const [versionsResult, versionItemsResult, currentItemsResult, wbsResult, changeOrdersResult] = await Promise.all([
    db.from("boq_versions").select("id,version_number,name,status,currency,net_value,valid_from,based_on_version_id,change_order_id,revision_kind,notes,submitted_at,approved_at,created_at,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("version_number", { ascending: false }).limit(100),
    db.from("boq_version_items").select("id,boq_version_id,lineage_id,source_boq_item_id,item_number,description,unit,quantity,unit_price,total_price,wbs_node_id,cost_code,change_order_id,change_type,revision_note")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("item_number", { ascending: true, nullsFirst: false }).limit(5000),
    db.from("boq_items").select("id,boq_version_id,lineage_id,item_number,item_no,description,unit,quantity,unit_price,total_price,total_value,wbs_node_id,cost_code")
      .eq("project_id", projectId).eq("is_active", true).order("item_number", { ascending: true, nullsFirst: false }).limit(2500),
    db.from("wbs_nodes").select("id,parent_id,code,name,branch,installation,zone,sort_order,status")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("sort_order", { ascending: true }).order("code", { ascending: true }).limit(1000),
    db.from("change_orders").select("id,number,title,description,status,value_change,days_change,impact_summary,submitted_at,decided_at,decision_note,approved_boq_version_id,created_at,updated_at")
      .eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(250)
  ]);

  const versions = rows(versionsResult as QueryResult, "wersji BOQ").map((row): BoqControlVersion => ({
    id: String(row.id), versionNumber: number(row.version_number), name: String(row.name), status: String(row.status),
    currency: String(row.currency ?? "PLN"), netValue: number(row.net_value), validFrom: text(row.valid_from),
    basedOnVersionId: text(row.based_on_version_id), changeOrderId: text(row.change_order_id), revisionKind: String(row.revision_kind ?? "baseline"),
    notes: text(row.notes), submittedAt: text(row.submitted_at), approvedAt: text(row.approved_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at ?? row.created_at)
  }));

  const versionItems = rows(versionItemsResult as QueryResult, "pozycji wersji BOQ").map((row): BoqControlItem => ({
    id: String(row.id), versionId: text(row.boq_version_id), lineageId: String(row.lineage_id), sourceBoqItemId: text(row.source_boq_item_id),
    itemNumber: text(row.item_number), description: String(row.description), unit: text(row.unit), quantity: nullableNumber(row.quantity),
    unitPrice: nullableNumber(row.unit_price), totalPrice: number(row.total_price), wbsNodeId: text(row.wbs_node_id), costCode: text(row.cost_code),
    changeOrderId: text(row.change_order_id), changeType: String(row.change_type) as BoqControlItem["changeType"], revisionNote: text(row.revision_note)
  }));

  const currentItems = rows(currentItemsResult as QueryResult, "aktywnego BOQ").map((row): BoqControlItem => ({
    id: String(row.id), versionId: text(row.boq_version_id), lineageId: String(row.lineage_id), sourceBoqItemId: String(row.id),
    itemNumber: text(row.item_number) ?? text(row.item_no), description: String(row.description), unit: text(row.unit), quantity: nullableNumber(row.quantity),
    unitPrice: nullableNumber(row.unit_price), totalPrice: number(row.total_price ?? row.total_value), wbsNodeId: text(row.wbs_node_id), costCode: text(row.cost_code),
    changeOrderId: null, changeType: "unchanged", revisionNote: null
  }));

  const wbsNodes = rows(wbsResult as QueryResult, "struktury WBS").map((row): WbsControlNode => ({
    id: String(row.id), parentId: text(row.parent_id), code: String(row.code), name: String(row.name), branch: text(row.branch),
    installation: text(row.installation), zone: text(row.zone), sortOrder: number(row.sort_order), status: String(row.status)
  }));

  const changeOrders = rows(changeOrdersResult as QueryResult, "rejestru zmian").map((row): ChangeOrderControlItem => ({
    id: String(row.id), number: text(row.number), title: String(row.title), description: text(row.description), status: String(row.status),
    valueChange: number(row.value_change), daysChange: number(row.days_change), impactSummary: (row.impact_summary ?? {}) as Record<string, unknown>,
    submittedAt: text(row.submitted_at), decidedAt: text(row.decided_at), decisionNote: text(row.decision_note),
    approvedBoqVersionId: text(row.approved_boq_version_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at ?? row.created_at)
  }));

  const itemsByVersion = new Map<string, BoqControlItem[]>();
  for (const item of versionItems) {
    if (!item.versionId) continue;
    const list = itemsByVersion.get(item.versionId) ?? [];
    list.push(item);
    itemsByVersion.set(item.versionId, list);
  }
  const currentVersionId = versions.find((version) => version.status === "approved")?.id ?? currentItems[0]?.versionId ?? null;
  const versionDiffs = Object.fromEntries(versions.map((version) => {
    const target = itemsByVersion.get(version.id) ?? (version.id === currentVersionId ? currentItems : []);
    const base = version.basedOnVersionId
      ? itemsByVersion.get(version.basedOnVersionId) ?? (version.basedOnVersionId === currentVersionId ? currentItems : [])
      : [];
    return [version.id, buildBoqVersionDiff(base, target)];
  }));

  return { versions, versionItems, currentItems, wbsNodes, changeOrders, versionDiffs };
}
