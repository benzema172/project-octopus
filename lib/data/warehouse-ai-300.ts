import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type WarehouseReview300 = {
  id: string;
  workspace_id: string;
  document_id: string;
  document_version_id: string;
  source_module: string | null;
  document_type: string | null;
  document_number: string | null;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  document_name: string | null;
  ai_summary: string | null;
  confidence: number;
  total_lines: number;
  stock_lines: number;
  review_lines: number;
  non_stock_lines: number;
  status: "warehouse" | "waiting" | "ignored";
  updated_at: string;
};

export type WarehouseAiLine300 = {
  id: string;
  review_id: string;
  document_id: string;
  document_version_id: string;
  source_line_index: number;
  raw_description: string;
  normalized_description: string;
  line_class: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  normalized_unit_price: number | null;
  currency: string | null;
  supplier_sku: string | null;
  manufacturer: string | null;
  model: string | null;
  ean: string | null;
  candidate_stock_item_id: string | null;
  match_confidence: number;
  decision: string;
  decision_reason: string | null;
  ai_metadata: Record<string, unknown> | null;
  human_corrected: boolean;
};

export type WarehouseDocumentPreview300 = {
  document_version_id: string;
  file_name: string;
  mime_type: string;
  excerpt: string;
};

export async function getWarehouseAi300Data(workspaceId: string) {
  const supabase = createServiceSupabaseClient();
  const { data: reviews, error: reviewsError } = await supabase
    .from("warehouse_document_reviews")
    .select("id,workspace_id,document_id,document_version_id,source_module,document_type,document_number,supplier_name,supplier_tax_id,document_name,ai_summary,confidence,total_lines,stock_lines,review_lines,non_stock_lines,status,updated_at")
    .eq("workspace_id", workspaceId)
    .neq("status", "ignored")
    .order("status", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(120)
    .returns<WarehouseReview300[]>();
  if (reviewsError) throw new Error(`Nie udało się załadować Poczekalni Magazynu: ${reviewsError.message}`);

  const reviewRows = reviews ?? [];
  const reviewIds = reviewRows.map((row) => row.id);
  const versionIds = reviewRows.map((row) => row.document_version_id);

  const [{ data: lines, error: linesError }, { data: versions, error: versionsError }, { data: texts, error: textsError }] = await Promise.all([
    reviewIds.length
      ? supabase
          .from("warehouse_ai_lines")
          .select("id,review_id,document_id,document_version_id,source_line_index,raw_description,normalized_description,line_class,quantity,unit,unit_price,normalized_unit_price,currency,supplier_sku,manufacturer,model,ean,candidate_stock_item_id,match_confidence,decision,decision_reason,ai_metadata,human_corrected")
          .in("review_id", reviewIds)
          .order("source_line_index", { ascending: true })
          .returns<WarehouseAiLine300[]>()
      : Promise.resolve({ data: [] as WarehouseAiLine300[], error: null }),
    versionIds.length
      ? supabase
          .from("document_versions")
          .select("id,file_name,mime_type")
          .in("id", versionIds)
          .returns<Array<{ id: string; file_name: string; mime_type: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; file_name: string; mime_type: string }>, error: null }),
    versionIds.length
      ? supabase
          .from("document_texts")
          .select("document_version_id,extracted_text")
          .in("document_version_id", versionIds)
          .returns<Array<{ document_version_id: string; extracted_text: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ document_version_id: string; extracted_text: string | null }>, error: null })
  ]);

  if (linesError) throw new Error(`Nie udało się załadować decyzji AI Magazynu: ${linesError.message}`);
  if (versionsError) throw new Error(`Nie udało się załadować metadanych dokumentów Magazynu: ${versionsError.message}`);
  if (textsError) throw new Error(`Nie udało się załadować podglądu tekstowego dokumentów: ${textsError.message}`);

  const versionById = new Map((versions ?? []).map((row) => [row.id, row]));
  const textByVersion = new Map((texts ?? []).map((row) => [row.document_version_id, row.extracted_text ?? ""]));
  const warehouseDocumentPreviews: WarehouseDocumentPreview300[] = versionIds.map((versionId) => {
    const version = versionById.get(versionId);
    return {
      document_version_id: versionId,
      file_name: version?.file_name ?? "Dokument",
      mime_type: version?.mime_type ?? "application/octet-stream",
      excerpt: (textByVersion.get(versionId) ?? "").replace(/\s+/g, " ").trim().slice(0, 7000)
    };
  });

  return {
    warehouseReviews: reviewRows,
    warehouseAiLines: lines ?? [],
    warehouseDocumentPreviews
  };
}
