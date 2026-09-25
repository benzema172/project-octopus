import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type SheetRow = Record<string, unknown>;
const clean = (value: unknown) => String(value ?? "").trim();
const headerKey = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
function pick(row: SheetRow, names: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [headerKey(key), value]));
  for (const name of names) if (normalized.has(name)) return normalized.get(name);
  return null;
}
function bool(value: unknown) {
  return ["1","true","tak","yes","y","syntetyczne"].includes(clean(value).toLowerCase());
}
function tax(value: unknown) {
  const v = clean(value).toUpperCase();
  return ["KUP","NKUP"].includes(v) ? v : ["NEUTRAL","NEUTRALNE"].includes(v) ? "neutral" : "review";
}
function vatPolicy(value: unknown) {
  const v = clean(value).toLowerCase();
  if (["full","pelne","100","100%"].includes(v)) return "full";
  if (["partial","czesciowe"].includes(v)) return "partial";
  if (["none","brak","0","0%"].includes(v)) return "none";
  return "review";
}
function accountType(value: unknown) {
  const v = clean(value).toLowerCase();
  const map: Record<string,string> = {
    aktywa:"asset", asset:"asset", pasywa:"liability", liability:"liability", koszt:"expense", koszty:"expense", expense:"expense",
    przychod:"revenue", przychody:"revenue", revenue:"revenue", podatek:"tax", tax:"tax", naleznosci:"receivable", receivable:"receivable",
    zobowiazania:"payable", payable:"payable", kapital:"equity", equity:"equity"
  };
  return map[v] ?? (v || "expense");
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  const form = await request.formData();
  const workspaceId = clean(form.get("workspaceId"));
  const file = form.get("file");
  if (!workspaceId || !(file instanceof File)) return NextResponse.json({ error: "Wybierz firmę i plik planu kont." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain: "finance", level: "approve" })) {
    return NextResponse.json({ error: "Import planu kont wymaga uprawnienia do zatwierdzania finansów." }, { status: 403 });
  }

  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!["csv","xlsx","xls"].includes(extension)) return NextResponse.json({ error: "Obsługiwane formaty planu kont: CSV, XLSX, XLS." }, { status: 422 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return NextResponse.json({ error: "Plik nie zawiera arkusza z planem kont." }, { status: 422 });
  const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: "" }).slice(0, 5000);
  if (!rows.length) return NextResponse.json({ error: "Plan kont jest pusty." }, { status: 422 });

  const db = createServiceSupabaseClient();
  const errors: string[] = [];
  let created = 0, updated = 0, rejected = 0;
  const parentByCode = new Map<string,string>();

  for (const [index, row] of rows.entries()) {
    const code = clean(pick(row, ["kod","konto","code","account_code"])).slice(0,120);
    const name = clean(pick(row, ["nazwa","name","account_name"])).slice(0,300);
    if (!code || !name) { rejected += 1; errors.push("Wiersz " + (index + 2) + ": brak kodu lub nazwy."); continue; }
    const parentCode = clean(pick(row, ["konto_nadrzedne","parent_code","parent","syntetyka"])).slice(0,120);
    const vatRaw = pick(row, ["vat_odliczenie","vat_deduction_pct","vat_pct"]);
    const vatPct = clean(vatRaw) ? Math.max(0, Math.min(100, Number(String(vatRaw).replace("%","").replace(",",".")) || 0)) : null;
    const payload = {
      workspace_id: workspaceId,
      code,
      name,
      account_type: accountType(pick(row, ["typ","account_type","type"])),
      level_no: Math.max(1, Number(pick(row, ["poziom","level","level_no"])) || 1),
      is_synthetic: bool(pick(row, ["syntetyczne","is_synthetic","synthetic"])),
      jpk_s12_1: clean(pick(row, ["jpk_s12_1","s_12_1","s12_1"])) || null,
      jpk_s12_2: clean(pick(row, ["jpk_s12_2","s_12_2","s12_2"])) || null,
      jpk_s12_3: clean(pick(row, ["jpk_s12_3","s_12_3","s12_3"])) || null,
      tax_default: tax(pick(row, ["kup_nkup","tax_default","podatek"])),
      vat_policy: vatPolicy(pick(row, ["vat","vat_policy","odliczenie_vat"])),
      vat_deduction_pct: vatPct,
      source: "accounting_plan_import",
      active: true,
      updated_at: new Date().toISOString()
    };
    const existing = await db.from("accounting_accounts").select("id").eq("workspace_id", workspaceId).eq("code", code).maybeSingle<{id:string}>();
    if (existing.error) { rejected += 1; errors.push("Wiersz " + (index + 2) + ": " + existing.error.message); continue; }
    if (existing.data) {
      const result = await db.from("accounting_accounts").update(payload).eq("id", existing.data.id).eq("workspace_id", workspaceId);
      if (result.error) { rejected += 1; errors.push("Wiersz " + (index + 2) + ": " + result.error.message); continue; }
      updated += 1;
    } else {
      const result = await db.from("accounting_accounts").insert(payload);
      if (result.error) { rejected += 1; errors.push("Wiersz " + (index + 2) + ": " + result.error.message); continue; }
      created += 1;
    }
    if (parentCode) parentByCode.set(code, parentCode);
  }

  if (parentByCode.size) {
    const allCodes = [...new Set([...parentByCode.keys(), ...parentByCode.values()])];
    const result = await db.from("accounting_accounts").select("id,code").eq("workspace_id", workspaceId).in("code", allCodes);
    const byCode = new Map(((result.data ?? []) as Array<{id:string;code:string}>).map((row) => [row.code,row.id]));
    for (const [code,parentCode] of parentByCode) {
      const id=byCode.get(code), parentId=byCode.get(parentCode);
      if (id && parentId) await db.from("accounting_accounts").update({ parent_account_id: parentId, updated_at: new Date().toISOString() }).eq("id",id).eq("workspace_id",workspaceId);
    }
  }

  const importRecord = await db.from("accounting_plan_imports").insert({
    workspace_id:workspaceId,file_name:file.name,format:extension,rows_total:rows.length,rows_created:created,rows_updated:updated,rows_rejected:rejected,
    errors:errors.slice(0,100),imported_by:user.id
  }).select("id").single<{id:string}>();
  await db.from("audit_events").insert({
    workspace_id:workspaceId,actor_id:user.id,actor_type:"user",event_type:"accounting.chart_imported_700",entity_type:"accounting_plan_import",
    entity_id:importRecord.data?.id ?? null,after_value:{fileName:file.name,rows:rows.length,created,updated,rejected}
  });
  return NextResponse.json({ ok:true, created, updated, rejected, errors:errors.slice(0,20) });
}
