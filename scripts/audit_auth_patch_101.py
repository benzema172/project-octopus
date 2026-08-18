from pathlib import Path

path = Path("app/api/company/records/route.ts")
text = path.read_text(encoding="utf-8")

anchor = '''async function loadAiBusinessDocument(workspaceId: string, documentIdValue: unknown) {'''
helper = '''async function resolveRecordAccessProjectId(entity: string, payload: Record<string, unknown>, workspaceId: string) {
  const directProjectEntities = new Set([
    "invoice", "commitment", "ai_invoice_import", "timesheet", "stock_movement",
    "ai_warehouse_import", "reservation", "fuel_entry", "trip", "report_definition"
  ]);
  if (directProjectEntities.has(entity)) return text(payload.projectId, "inwestycja");

  const db = createServiceSupabaseClient();
  if (entity === "timesheet_decision") {
    const id = text(payload.timesheetId, "wpis czasu pracy");
    if (!id) return null;
    const { data } = await db.from("timesheets").select("project_id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ project_id: string | null }>();
    return data?.project_id ?? null;
  }
  if (entity === "stock_movement_approve") {
    const id = text(payload.movementId, "ruch magazynowy");
    if (!id) return null;
    const { data } = await db.from("stock_movements").select("project_id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ project_id: string | null }>();
    return data?.project_id ?? null;
  }
  if (entity === "report_generate") {
    const id = text(payload.definitionId, "definicja raportu");
    if (!id) return null;
    const { data } = await db.from("report_definitions").select("project_id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ project_id: string | null }>();
    return data?.project_id ?? null;
  }
  return null;
}

'''
if helper not in text:
    if anchor not in text:
        raise SystemExit("authorization helper anchor missing")
    text = text.replace(anchor, helper + anchor, 1)

old = '''  const approvalEntities = new Set(["leave_decision", "timesheet_decision", "stock_movement_approve"]);
  const requiredLevel = approvalEntities.has(body.entity) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: requiredLevel, projectId: text(body.payload.projectId, "inwestycja") })) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu w tym module." }, { status: 403 });
  }

  const supabase = createServiceSupabaseClient();
'''
new = '''  const approvalEntities = new Set(["leave_decision", "timesheet_decision", "stock_movement_approve"]);
  const requiredLevel = approvalEntities.has(body.entity) ? "approve" : "write";
  const accessProjectId = await resolveRecordAccessProjectId(body.entity, body.payload, workspace.id);
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: requiredLevel, projectId: accessProjectId })) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu w tym module." }, { status: 403 });
  }

  const supabase = createServiceSupabaseClient();
'''
if old not in text:
    raise SystemExit("authorization check target missing")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print("Authorization audit patch applied")
