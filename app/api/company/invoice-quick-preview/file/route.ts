import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { malwareScanRequiredByPolicy } from "@/lib/documents/malware-scan";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { inlineContentDisposition } from "@/lib/r2/sanitize";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
const ALLOWED_DOMAINS = new Set<Domain>(["finance", "warehouse", "fleet"]);

type InvoiceRow = { id: string; document_id: string | null };
type DocumentRow = { id: string; current_version_id: string | null };
type VersionRow = { id: string; file_name: string; mime_type: string; r2_bucket: string; r2_object_key: string; malware_scan_status: string | null };
type InvoiceLineRow = { id: string; invoice_id: string; stock_item_id: string | null; vehicle_id: string | null };

function lineMatchesDomain(domain: Domain, line: InvoiceLineRow | null) {
  if (domain === "finance") return true;
  if (!line) return false;
  if (domain === "warehouse") return Boolean(line.stock_item_id);
  if (domain === "fleet") return Boolean(line.vehicle_id);
  return false;
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return new Response("Brak aktywnej sesji.", { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const domainValue = url.searchParams.get("domain")?.trim() ?? "";
  const invoiceId = url.searchParams.get("invoiceId")?.trim() ?? "";
  const invoiceLineId = url.searchParams.get("invoiceLineId")?.trim() ?? "";
  if (!workspaceId || !domainValue || !invoiceId) return new Response("Brakuje kontekstu faktury.", { status: 400 });
  if (!ALLOWED_DOMAINS.has(domainValue as Domain)) return new Response("Ten moduł nie obsługuje podglądu faktur.", { status: 400 });
  const domain = domainValue as Domain;
  if (domain !== "finance" && !invoiceLineId) return new Response("Otwieranie faktury poza Finansami wymaga dokładnej pozycji.", { status: 400 });

  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return new Response("Brak dostępu do firmy.", { status: 403 });
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain, level: "read" })) return new Response("Brak dostępu do faktury w tym module.", { status: 403 });

  const db = createServiceSupabaseClient();
  if (invoiceLineId) {
    const { data: line } = await db.from("invoice_lines")
      .select("id,invoice_id,stock_item_id,vehicle_id")
      .eq("workspace_id", workspaceId)
      .eq("id", invoiceLineId)
      .eq("invoice_id", invoiceId)
      .maybeSingle<InvoiceLineRow>();
    if (!line || !lineMatchesDomain(domain, line)) return new Response("Ta pozycja nie należy do kontekstu tego modułu.", { status: 403 });
  }

  const { data: invoice } = await db.from("invoices").select("id,document_id").eq("workspace_id", workspaceId).eq("id", invoiceId).maybeSingle<InvoiceRow>();
  if (!invoice?.document_id) return new Response("Faktura nie ma zapisanego dokumentu źródłowego.", { status: 404 });
  const { data: document } = await db.from("documents").select("id,current_version_id").eq("workspace_id", workspaceId).eq("id", invoice.document_id).maybeSingle<DocumentRow>();
  if (!document?.current_version_id) return new Response("Faktura nie ma zapisanej wersji pliku.", { status: 404 });
  const { data: version } = await db.from("document_versions")
    .select("id,file_name,mime_type,r2_bucket,r2_object_key,malware_scan_status")
    .eq("id", document.current_version_id)
    .maybeSingle<VersionRow>();
  if (!version) return new Response("Nie znaleziono pliku faktury.", { status: 404 });
  if (version.malware_scan_status === "infected") return new Response("Dokument jest w kwarantannie.", { status: 423 });
  if (version.malware_scan_status === "pending" && malwareScanRequiredByPolicy()) return new Response("Dokument oczekuje na wymagany skan bezpieczeństwa.", { status: 423 });

  const config = getR2Config();
  if (version.r2_bucket !== config.bucketName) return new Response("Nieprawidłowa lokalizacja pliku.", { status: 409 });
  const object = await createR2Client().send(new GetObjectCommand({ Bucket: version.r2_bucket, Key: version.r2_object_key }));
  if (!object.Body) return new Response("Nie udało się odczytać faktury.", { status: 404 });
  const bytes = new Uint8Array(await object.Body.transformToByteArray());
  return new Response(bytes, {
    headers: {
      "Content-Type": version.mime_type || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": inlineContentDisposition(version.file_name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
