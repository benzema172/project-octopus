import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type SettlementModel = "monthly" | "hourly_with_monthly_base";
type Body = {
  workspaceId?: string;
  employeeId?: string;
  settlementModel?: SettlementModel;
  operationalNetHourlyRate?: string | number | null;
};

function positiveRate(value: unknown) {
  const parsed = parseLocalizedNumber(value as string | number);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Uzupełnij dodatnią stawkę operacyjną netto za godzinę.");
  return parsed;
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

  if (!body.workspaceId || !body.employeeId || !body.settlementModel) {
    return NextResponse.json({ error: "Brakuje firmy, pracownika lub modelu rozliczenia." }, { status: 400 });
  }
  if (!["monthly", "hourly_with_monthly_base"].includes(body.settlementModel)) {
    return NextResponse.json({ error: "Nieprawidłowy model rozliczenia pracownika." }, { status: 400 });
  }

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const [hrApprove, financeWrite] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" })
  ]);
  if (!hrApprove && !financeWrite) {
    return NextResponse.json({ error: "Brak uprawnienia do ustawienia modelu wynagrodzenia i stawek." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const { data: employee, error: employeeError } = await db.from("employees")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("id", body.employeeId)
    .maybeSingle<{ id: string }>();
  if (employeeError || !employee) return NextResponse.json({ error: "Pracownik nie należy do aktywnej firmy." }, { status: 404 });

  const { data: employments, error: employmentError } = await db.from("employments")
    .select("id,monthly_cost,nominal_monthly_hours")
    .eq("workspace_id", workspace.id)
    .eq("employee_id", body.employeeId)
    .order("valid_from", { ascending: false })
    .limit(1);
  if (employmentError) return NextResponse.json({ error: `Nie udało się pobrać warunków zatrudnienia: ${employmentError.message}` }, { status: 400 });
  const employment = (employments ?? [])[0] as { id: string; monthly_cost: number | null; nominal_monthly_hours: number | null } | undefined;
  if (!employment) return NextResponse.json({ error: "Najpierw zapisz warunki zatrudnienia pracownika." }, { status: 409 });

  try {
    const model = body.settlementModel;
    const operationalRate = model === "hourly_with_monthly_base" ? positiveRate(body.operationalNetHourlyRate) : null;
    const monthlyCost = Number(employment.monthly_cost ?? 0);
    const nominalHours = Number(employment.nominal_monthly_hours ?? 0);
    const formalHourlyCost = monthlyCost > 0 && nominalHours > 0 ? monthlyCost / nominalHours : null;
    const patch = model === "hourly_with_monthly_base"
      ? { settlement_model: model, operational_net_hourly_rate: operationalRate, hourly_cost: operationalRate }
      : { settlement_model: model, operational_net_hourly_rate: null, hourly_cost: formalHourlyCost };

    const { error } = await db.from("employments")
      .update(patch)
      .eq("workspace_id", workspace.id)
      .eq("employee_id", body.employeeId)
      .eq("id", employment.id);
    if (error) throw error;

    const { error: auditError } = await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      actor_type: "user",
      event_type: "hr.employee_settlement_model",
      entity_type: "employee",
      entity_id: body.employeeId,
      after_value: {
        settlement_model: model,
        operational_net_hourly_rate: operationalRate,
        investment_hourly_cost: model === "hourly_with_monthly_base" ? operationalRate : formalHourlyCost
      }
    });
    if (auditError) console.error("Project Octopus HR settlement model audit failed", auditError.message);

    return NextResponse.json({
      ok: true,
      settlementModel: model,
      operationalNetHourlyRate: operationalRate,
      investmentHourlyCost: model === "hourly_with_monthly_base" ? operationalRate : formalHourlyCost
    });
  } catch (error) {
    console.error("Project Octopus HR settlement model failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się ustawić modelu rozliczenia." }, { status: 400 });
  }
}
