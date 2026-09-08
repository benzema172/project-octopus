import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const ALLOWED_DOMAINS = new Set<Domain>(["finance", "warehouse", "fleet"]);
type Row = Record<string, unknown>;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function lineMatchesDomain(domain: Domain, line: Row | null) {
  if (domain === "finance") return true;
  if (!line) return false;
  if (domain === "warehouse") return Boolean(line.stock_item_id);
  if (domain === "fleet") return Boolean(line.vehicle_id);
  return false;
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const domainValue = url.searchParams.get("domain")?.trim() ?? "";
  const invoiceLineId = url.searchParams.get("invoiceLineId")?.trim() ?? "";
  const requestedInvoiceId = url.searchParams.get("invoiceId")?.trim() ?? "";
  const invoiceNumber = url.searchParams.get("invoiceNumber")?.trim() ?? "";
  const stockItemId = url.searchParams.get("stockItemId")?.trim() ?? "";

  if (!workspaceId || !domainValue || (!invoiceLineId && !requestedInvoiceId && !invoiceNumber)) {
    return jsonError("Brakuje kontekstu faktury.", 400);
  }
  if (!ALLOWED_DOMAINS.has(domainValue as Domain)) return jsonError("Ten moduł nie obsługuje podglądu faktur.", 400);
  const domain = domainValue as Domain;
  if (domain !== "finance" && !invoiceLineId) return jsonError("Podgląd poza Finansami wymaga dokładnej pozycji faktury.", 400);

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return jsonError("Brak dostępu do firmy.", 403);
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain, level: "read" })) {
    return jsonError("Brak dostępu do podglądu faktury w tym module.", 403);
  }

  const db = createServiceSupabaseClient();
  let targetLine: Row | null = null;
  let invoiceId = requestedInvoiceId;

  if (invoiceLineId) {
    const { data, error } = await db.from("invoice_lines")
      .select("id,invoice_id,line_number,description,quantity,unit,unit_price,net_amount,tax_rate,gross_amount,stock_item_id,vehicle_id,supplier_sku")
      .eq("workspace_id", workspaceId)
      .eq("id", invoiceLineId)
      .maybeSingle();
    if (error) return jsonError(`Nie udało się odczytać pozycji faktury: ${error.message}`, 500);
    if (!data) return jsonError("Nie znaleziono pozycji faktury.", 404);
    targetLine = data as Row;
    if (!lineMatchesDomain(domain, targetLine)) return jsonError("Ta pozycja faktury nie należy do kontekstu tego modułu.", 403);
    invoiceId = String(targetLine.invoice_id ?? "");
  }

  let invoiceQuery = db.from("invoices")
    .select("id,counterparty_id,document_id,invoice_number,ksef_number,direction,issue_date,sale_date,due_date,currency,net_amount,tax_amount,gross_amount,paid_amount,status")
    .eq("workspace_id", workspaceId);
  if (invoiceId) invoiceQuery = invoiceQuery.eq("id", invoiceId);
  else invoiceQuery = invoiceQuery.eq("invoice_number", invoiceNumber).order("issue_date", { ascending: false }).limit(1);
  const { data: invoiceData, error: invoiceError } = await invoiceQuery.maybeSingle();
  if (invoiceError) return jsonError(`Nie udało się odczytać faktury: ${invoiceError.message}`, 500);
  if (!invoiceData) return jsonError("Nie znaleziono faktury.", 404);
  const invoice = invoiceData as Row;
  invoiceId = String(invoice.id);

  const [{ data: linesData, error: linesError }, { data: counterpartyData }, { data: documentData }] = await Promise.all([
    db.from("invoice_lines")
      .select("id,invoice_id,line_number,description,quantity,unit,unit_price,net_amount,tax_rate,gross_amount,stock_item_id,vehicle_id,supplier_sku")
      .eq("workspace_id", workspaceId)
      .eq("invoice_id", invoiceId)
      .order("line_number", { ascending: true }),
    invoice.counterparty_id
      ? db.from("counterparties").select("id,name,tax_id").eq("workspace_id", workspaceId).eq("id", String(invoice.counterparty_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    invoice.document_id
      ? db.from("documents").select("id,current_version_id,project_id,name,category").eq("workspace_id", workspaceId).eq("id", String(invoice.document_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (linesError) return jsonError(`Nie udało się odczytać pozycji faktury: ${linesError.message}`, 500);
  const lines = (linesData ?? []) as unknown as Row[];

  if (!targetLine && stockItemId) targetLine = lines.find((line) => String(line.stock_item_id ?? "") === stockItemId) ?? null;
  if (!targetLine && invoiceLineId) targetLine = lines.find((line) => String(line.id) === invoiceLineId) ?? null;

  const document = documentData as Row | null;
  const versionId = String(document?.current_version_id ?? "");
  let version: Row | null = null;
  if (versionId) {
    const { data } = await db.from("document_versions")
      .select("id,file_name,mime_type,page_count,malware_scan_status")
      .eq("id", versionId)
      .maybeSingle();
    version = (data as Row | null) ?? null;
  }

  let source: Row | null = null;
  if (targetLine?.id) {
    const { data: linkData } = await db.from("entity_source_links")
      .select("source_reference_id,document_version_id,source_locator,source_excerpt,confidence")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "invoice_line")
      .eq("entity_id", String(targetLine.id))
      .order("confidence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (linkData?.source_reference_id) {
      const { data: refData } = await db.from("source_references")
        .select("page_no,page_number,bounding_box,locator,quote_excerpt,section_label")
        .eq("id", linkData.source_reference_id)
        .maybeSingle();
      source = { ...(linkData as Row), ...((refData as Row | null) ?? {}) };
    } else if (linkData) source = linkData as Row;
  }

  return NextResponse.json({
    invoice,
    counterparty: (counterpartyData as Row | null) ?? null,
    lines,
    targetLineId: targetLine?.id ? String(targetLine.id) : null,
    document: document ? { id: document.id, projectId: document.project_id ?? null, versionId: versionId || null, name: document.name, category: document.category } : null,
    version,
    source
  }, { headers: { "Cache-Control": "private, no-store" } });
}
