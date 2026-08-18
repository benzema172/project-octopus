import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { projectId?: string; warehouseId?: string; stockItemId?: string; quantity?: string | number; requiredAt?: string };

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane rezerwacji." }, { status: 400 }); }
  if (!body.projectId || !body.warehouseId || !body.stockItemId) return NextResponse.json({ error: "Brakuje inwestycji, magazynu lub materiału." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "warehouse", level: "write", projectId: project.id })) return NextResponse.json({ error: "Brak uprawnienia do rezerwacji magazynowych." }, { status: 403 });
  const quantity = parseLocalizedNumber(body.quantity);
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("create_reservation_atomic", {
    p_workspace_id: project.workspace_id,
    p_project_id: project.id,
    p_warehouse_id: body.warehouseId,
    p_stock_item_id: body.stockItemId,
    p_quantity: quantity,
    p_required_at: body.requiredAt || null,
    p_actor_id: user.id
  }).single<{ result_id: string; available_now: number }>();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Nie udało się utworzyć rezerwacji." }, { status: 400 });
  return NextResponse.json({ ok: true, id: data.result_id, status: "open", availableNow: data.available_now });
}
