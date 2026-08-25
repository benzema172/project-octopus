import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildBoqVersionDiff, type BoqControlItem } from "../lib/boq-version-diff";

const item = (input: Partial<BoqControlItem> & Pick<BoqControlItem, "lineageId" | "description" | "totalPrice">): BoqControlItem => ({
  id: input.id ?? input.lineageId,
  versionId: input.versionId ?? null,
  lineageId: input.lineageId,
  sourceBoqItemId: input.sourceBoqItemId ?? null,
  itemNumber: input.itemNumber ?? null,
  description: input.description,
  unit: input.unit ?? "szt.",
  quantity: input.quantity ?? 1,
  unitPrice: input.unitPrice ?? input.totalPrice,
  totalPrice: input.totalPrice,
  wbsNodeId: input.wbsNodeId ?? null,
  costCode: input.costCode ?? null,
  changeOrderId: input.changeOrderId ?? null,
  changeType: input.changeType ?? "unchanged",
  revisionNote: input.revisionNote ?? null
});

describe("BOQ / WBS Change Control", () => {
  it("calculates added, modified and removed lineages without losing the value delta", () => {
    const base = [
      item({ lineageId: "a", itemNumber: "1.1", description: "Rurociąg", quantity: 10, unitPrice: 5, totalPrice: 50 }),
      item({ lineageId: "b", itemNumber: "1.2", description: "Zawór", totalPrice: 100 })
    ];
    const target = [
      item({ lineageId: "a", itemNumber: "1.1", description: "Rurociąg", quantity: 12, unitPrice: 5, totalPrice: 60, changeType: "modified" }),
      item({ lineageId: "c", itemNumber: "1.3", description: "Izolacja", totalPrice: 40, changeType: "added" })
    ];

    const diff = buildBoqVersionDiff(base, target);
    expect(diff).toMatchObject({ added: 1, modified: 1, removed: 1, beforeValue: 150, afterValue: 100, deltaValue: -50 });
    expect(diff.rows.map((row) => [row.lineageId, row.changeType])).toEqual([["a", "modified"], ["b", "removed"], ["c", "added"]]);
  });

  it("installs controlled drafts, immutable accepted snapshots, active projections and service-only RPCs", () => {
    const core = readFileSync("supabase/migrations/20260824143000_boq_wbs_change_control.sql", "utf8");
    const projections = readFileSync("supabase/migrations/20260824144000_boq_active_projections.sql", "utf8");
    expect(core).toContain("create table if not exists public.boq_version_items");
    expect(core).toContain("function public.create_boq_revision_atomic");
    expect(core).toContain("function public.save_boq_revision_item_atomic");
    expect(core).toContain("function public.approve_boq_version_atomic");
    expect(core).toContain("function public.upsert_wbs_node_atomic");
    expect(core).toContain("function public.review_change_order_atomic");
    expect(core).toContain("Only a draft BOQ version can be edited");
    expect(core).toContain("revoke all on function public.approve_boq_version_atomic");
    expect(core).toContain("grant execute on function public.approve_boq_version_atomic");
    expect(projections).toContain("b.is_active=true");
    expect(projections).toContain("get_project_autopilot_compact_snapshot");
    expect(projections).toContain("get_project_reconciliation_snapshot");
  });

  it("exposes a real editor and rechecks project/domain authorization in the API", () => {
    const page = readFileSync("app/workspace/projects/[projectId]/cost-estimate/page.tsx", "utf8");
    const component = readFileSync("components/projects/boq-change-control-workspace.tsx", "utf8");
    const route = readFileSync("app/api/projects/boq-control/route.ts", "utf8");
    expect(page).toContain("getProjectBoqControl");
    expect(page).toContain("BoqChangeControlWorkspace");
    expect(component).toContain("Kosztorys bez nadpisywania historii");
    expect(component).toContain("Porównanie z wersją bazową");
    expect(component).toContain("Struktura WBS");
    expect(component).toContain("Rejestr Change Order");
    expect(route).toContain("getRequestUser");
    expect(route).toContain("getProjectForUser");
    expect(route).toContain("hasDomainAccess");
    expect(route).toContain("level: \"approve\"");
  });
});
