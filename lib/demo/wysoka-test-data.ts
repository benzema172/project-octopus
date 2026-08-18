import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { SEED_EVENT, SEED_SCHEMA, findOne, type Row, type SeedInput } from "@/lib/demo/wysoka-seed-shared";
import { seedProjectCore } from "@/lib/demo/wysoka-seed-project";
import { seedDocuments } from "@/lib/demo/wysoka-seed-documents";
import { seedFinance } from "@/lib/demo/wysoka-seed-finance";
import { seedHr } from "@/lib/demo/wysoka-seed-hr";
import { seedWarehouse } from "@/lib/demo/wysoka-seed-warehouse";
import { seedFleet } from "@/lib/demo/wysoka-seed-fleet";
import { seedReports } from "@/lib/demo/wysoka-seed-reports";

export type WysokaSeedResult = {
  projectId: string; workspaceId: string; alreadySeeded: boolean; documents: number; financeRecords: number;
  hrRecords: number; warehouseRecords: number; fleetRecords: number; projectRecords: number; reportRecords: number;
};

export async function seedWysokaTestData(input: SeedInput): Promise<WysokaSeedResult> {
  const db = createServiceSupabaseClient();
  const marker = await findOne(db, "audit_events", {
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    event_type: SEED_EVENT,
    entity_type: "project",
    entity_id: input.projectId
  });

  if (marker) {
    const summary = marker.after_value && typeof marker.after_value === "object" ? marker.after_value as Row : {};
    return {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      alreadySeeded: true,
      documents: Number(summary.documents ?? 0),
      financeRecords: Number(summary.financeRecords ?? 0),
      hrRecords: Number(summary.hrRecords ?? 0),
      warehouseRecords: Number(summary.warehouseRecords ?? 0),
      fleetRecords: Number(summary.fleetRecords ?? 0),
      projectRecords: Number(summary.projectRecords ?? 0),
      reportRecords: Number(summary.reportRecords ?? 0)
    };
  }

  const project = await findOne(db, "projects", { id: input.projectId, workspace_id: input.workspaceId }, "id,name");
  const { data: profileCheckRows, error: profileCheckError } = await db.from("project_facts")
    .select("value_json").eq("project_id", input.projectId).eq("fact_type", "project_profile")
    .order("updated_at", { ascending: false }).limit(1);
  if (profileCheckError) throw new Error(`Seed identyfikacji Wysoka: ${profileCheckError.message}`);
  const profileCheck = (profileCheckRows?.[0] as { value_json?: Row } | undefined)?.value_json ?? {};
  const candidateNames = [project?.name, profileCheck.shortName, profileCheck.projectName]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLocaleLowerCase("pl").replace(/[\"'„”]/g, "").trim());
  if (!project || !candidateNames.includes("wysoka")) {
    throw new Error("Seed może zasilić wyłącznie istniejącą inwestycję identyfikowaną jako Wysoka.");
  }

  const [projectCore, documents, hr, reportRecords] = await Promise.all([
    seedProjectCore(db, input),
    seedDocuments(db, input),
    seedHr(db, input),
    seedReports(db, input)
  ]);
  const [financeRecords, warehouse, fleetRecords] = await Promise.all([
    seedFinance(db, input, documents.ids, projectCore.boq, projectCore.wbs),
    seedWarehouse(db, input, projectCore.boq, documents.ids),
    seedFleet(db, input, hr.employeeIds)
  ]);

  const markerInsert = await db.from("audit_events").insert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    actor_id: input.actorId,
    actor_type: "user",
    event_type: SEED_EVENT,
    entity_type: "project",
    entity_id: input.projectId,
    after_value: {
      schema: SEED_SCHEMA,
      documents: documents.created,
      projectRecords: projectCore.created,
      financeRecords,
      hrRecords: hr.created,
      warehouseRecords: warehouse.created,
      fleetRecords,
      reportRecords,
      note: "Kontrolowane dane demonstracyjne. Nie są danymi rzeczywistymi ani pomiarowymi."
    }
  });
  if (markerInsert.error) throw new Error(`Seed marker: ${markerInsert.error.message}`);

  return {
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    alreadySeeded: false,
    documents: documents.created,
    financeRecords,
    hrRecords: hr.created,
    warehouseRecords: warehouse.created,
    fleetRecords,
    projectRecords: projectCore.created,
    reportRecords
  };
}
