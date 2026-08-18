import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  action?: "save" | "approve" | "reject";
  protocolId?: string | null;
  protocolRequirementId?: string | null;
  protocolType?: string;
  title?: string;
  protocolDate?: string | null;
  performedAt?: string | null;
  scope?: string;
  location?: string;
  testMedium?: string;
  testPressure?: string | number | null;
  pressureUnit?: string;
  testDurationMinutes?: string | number | null;
  measurementDevice?: string;
  result?: string;
  remarks?: string;
  participants?: Array<{ name: string; role?: string; company?: string; signed?: boolean }>;
  evidence?: Array<{ documentId?: string | null; type?: string; label: string; notes?: string }>;
  note?: string;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane protokołu." }, { status: 400 }); }
  if (!body.projectId || !body.action) return NextResponse.json({ error: "Brakuje inwestycji lub operacji." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu protokołów." }, { status: 403 });
  }
  const db = createServiceSupabaseClient();
  try {
    if (body.action === "save") {
      const pressure = body.testPressure == null || clean(String(body.testPressure)) === "" ? null : parseLocalizedNumber(body.testPressure);
      const duration = body.testDurationMinutes == null || clean(String(body.testDurationMinutes)) === "" ? null : Math.round(parseLocalizedNumber(body.testDurationMinutes));
      const { data, error } = await db.rpc("save_protocol_result_atomic", {
        p_workspace_id: project.workspace_id,
        p_project_id: project.id,
        p_protocol_id: nullable(body.protocolId),
        p_protocol_requirement_id: nullable(body.protocolRequirementId),
        p_protocol_type: clean(body.protocolType),
        p_title: clean(body.title),
        p_protocol_date: nullable(body.protocolDate),
        p_performed_at: nullable(body.performedAt),
        p_scope: clean(body.scope),
        p_location: clean(body.location),
        p_test_medium: clean(body.testMedium),
        p_test_pressure: pressure,
        p_pressure_unit: clean(body.pressureUnit),
        p_test_duration_minutes: duration,
        p_measurement_device: clean(body.measurementDevice),
        p_result: clean(body.result),
        p_remarks: clean(body.remarks),
        p_participants: body.participants ?? [],
        p_evidence: body.evidence ?? [],
        p_actor_id: user.id
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: data });
    }
    if (!body.protocolId) throw new Error("Brakuje identyfikatora protokołu.");
    const { data, error } = await db.rpc("review_protocol_atomic", {
      p_workspace_id: project.workspace_id,
      p_project_id: project.id,
      p_protocol_id: body.protocolId,
      p_decision: body.action,
      p_note: clean(body.note),
      p_actor_id: user.id
    }).single<{ result_id: string; result_status: string }>();
    if (error || !data) throw new Error(error?.message ?? "Brak wyniku operacji.");
    return NextResponse.json({ ok: true, id: data.result_id, status: data.result_status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać protokołu." }, { status: 400 });
  }
}
