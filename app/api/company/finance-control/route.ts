import { NextResponse } from "next/server";
import { answerFinanceCfoQuestion } from "@/lib/ai/gemini-finance-cfo";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import {
  addCashflowItem,
  approveBankMatch,
  importBankFile,
  requestKsefSync,
  saveFinanceScenario
} from "@/lib/data/finance-control-actions";
import { getFinanceControlTower } from "@/lib/data/finance-control-tower";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Action = "bank_import" | "bank_match_approve" | "cashflow_item_add" | "scenario_save" | "ksef_sync" | "cfo_ask";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string, unknown> };

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 }); }
  if (!body.workspaceId || !body.action) return NextResponse.json({ error: "Brakuje firmy lub operacji." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const payload = body.payload ?? {};
  const db = createServiceSupabaseClient();

  const requireFinance = async (level: "read" | "write" | "approve") => {
    const allowed = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level });
    if (!allowed) throw new Error(level === "approve" ? "Brak uprawnienia do zatwierdzania finansów." : level === "write" ? "Brak uprawnienia do zmiany danych finansowych." : "Brak dostępu do finansów.");
  };
  const audit = async (eventType: string, afterValue: Record<string, unknown>) => {
    await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      event_type: eventType,
      entity_type: "finance_control_tower",
      after_value: afterValue
    });
  };

  try {
    if (body.action === "cfo_ask") {
      await requireFinance("read");
      const question = text(payload.question, "pytanie", true);
      const data = await getFinanceControlTower(workspace.id);
      return NextResponse.json({ ok: true, ...(await answerFinanceCfoQuestion(data, question)) });
    }

    if (body.action === "bank_import") {
      await requireFinance("write");
      const content = text(payload.content, "plik bankowy", true);
      const fileName = text(payload.fileName, "nazwa pliku") || "bank.csv";
      const result = await importBankFile(workspace.id, user.id, content, fileName);
      await audit("finance.bank_imported", { fileName, ...result });
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "bank_match_approve") {
      await requireFinance("approve");
      const matchId = text(payload.matchId, "dopasowanie", true);
      const result = await approveBankMatch(workspace.id, user.id, matchId);
      await audit("finance.bank_match_approved", { matchId, result });
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "cashflow_item_add") {
      await requireFinance("write");
      const result = await addCashflowItem(workspace.id, user.id, payload);
      await audit("finance.cashflow_item_added", { id: result?.id ?? null, label: payload.label ?? null });
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === "scenario_save") {
      await requireFinance("write");
      const result = await saveFinanceScenario(workspace.id, user.id, payload);
      await audit("finance.scenario_saved", { id: result?.id ?? null, name: payload.name ?? null });
      return NextResponse.json({ ok: true, result });
    }

    await requireFinance("write");
    const result = await requestKsefSync(workspace.id, user.id);
    await audit("finance.ksef_sync_requested", { configured: result.configured });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja nie powiodła się." }, { status: 422 });
  }
}
