import { asId, ensureRow, type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedReports(db: Db, input: SeedInput) {
  let created = 0;
  const definitions = [
    ["[TEST] Raport finansowy Wysoka", "finance", { sections: ["revenue", "cost", "margin", "commitments"] }],
    ["[TEST] Raport postępu Wysoka", "progress", { sections: ["boq", "schedule", "protocols"] }],
    ["[TEST] Raport magazynowy Wysoka", "warehouse", { sections: ["stock", "movements", "reservations"] }],
    ["[TEST] Raport kadrowy firmy", "hr", { sections: ["employees", "hours", "qualifications"] }],
    ["[TEST] Raport floty firmy", "fleet", { sections: ["fuel", "service", "damages"] }]
  ] as const;
  for (const [name, reportType, definition] of definitions) {
    const report = await ensureRow(db, "report_definitions", { workspace_id: input.workspaceId, name }, {
      project_id: reportType === "hr" || reportType === "fleet" ? null : input.projectId,
      report_type: reportType, definition, schedule_rule: reportType === "finance" ? "monthly" : null, active: true, created_by: input.actorId
    });
    if (report.created) created += 1;
    const reportId = asId(report.row);
    const run = await ensureRow(db, "report_runs", { workspace_id: input.workspaceId, report_definition_id: reportId, period_start: "2026-08-01", period_end: "2026-08-31" }, {
      project_id: reportType === "hr" || reportType === "fleet" ? null : input.projectId,
      status: "completed", started_at: "2026-08-18T06:00:00+02:00", finished_at: "2026-08-18T06:00:03+02:00"
    });
    if (run.created) created += 1;
    const runId = asId(run.row);
    const snapshot = await ensureRow(db, "report_snapshots", { workspace_id: input.workspaceId, report_run_id: runId }, {
      project_id: reportType === "hr" || reportType === "fleet" ? null : input.projectId,
      kpi_definitions: { demo: true },
      data_snapshot: { reportType, generatedFor: "Wysoka", demo: true, period: "2026-08" },
      narrative: { summary: `Raport testowy ${name}. Dane służą do sprawdzenia widoku i eksportu.` },
      closed_at: "2026-08-18T06:00:03+02:00"
    });
    if (snapshot.created) created += 1;
  }
  return created;
}
