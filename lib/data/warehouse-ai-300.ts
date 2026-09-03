import "server-only";

import { getStockBalances } from "@/lib/data/stock-balances";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type WarehouseReview300 = {
  id: string;
  workspace_id: string;
  document_id: string;
  document_version_id: string;
  project_id: string | null;
  source_module: string | null;
  document_type: string | null;
  document_number: string | null;
  document_direction: string | null;
  document_date: string | null;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  document_name: string | null;
  ai_summary: string | null;
  confidence: number;
  source_line_count: number;
  total_lines: number;
  stock_lines: number;
  review_lines: number;
  non_stock_lines: number;
  draft_movement_id: string | null;
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

type CountResult = { count: number | null; error: { message: string } | null };

export async function getWarehouseAi300Data(workspaceId: string) {
  const supabase = createServiceSupabaseClient();
  const { data: reviews, error: reviewsError } = await supabase
    .from("warehouse_document_reviews")
    .select("id,workspace_id,document_id,document_version_id,project_id,source_module,document_type,document_number,document_direction,document_date,supplier_name,supplier_tax_id,document_name,ai_summary,confidence,source_line_count,total_lines,stock_lines,review_lines,non_stock_lines,draft_movement_id,status,updated_at")
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

  const [
    linesResult,
    versionsResult,
    textsResult,
    catalogResult,
    locationsResult,
    assignmentsResult,
    reservationsResult,
    instancesResult,
    pricesResult,
    decisionEventsResult,
    costLayersResult,
    purchaseOrdersResult,
    balances,
    totalMetric,
    autoMetric,
    correctedMetric,
    learnedMetric
  ] = await Promise.all([
    reviewIds.length
      ? supabase.from("warehouse_ai_lines")
          .select("id,review_id,document_id,document_version_id,source_line_index,raw_description,normalized_description,line_class,quantity,unit,unit_price,normalized_unit_price,currency,supplier_sku,manufacturer,model,ean,candidate_stock_item_id,match_confidence,decision,decision_reason,ai_metadata,human_corrected")
          .in("review_id", reviewIds).order("source_line_index", { ascending: true }).returns<WarehouseAiLine300[]>()
      : Promise.resolve({ data: [] as WarehouseAiLine300[], error: null }),
    versionIds.length
      ? supabase.from("document_versions").select("id,file_name,mime_type").in("id", versionIds).returns<Array<{ id: string; file_name: string; mime_type: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; file_name: string; mime_type: string }>, error: null }),
    versionIds.length
      ? supabase.from("document_texts").select("document_version_id,extracted_text").in("document_version_id", versionIds).returns<Array<{ document_version_id: string; extracted_text: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ document_version_id: string; extracted_text: string | null }>, error: null }),
    supabase.from("stock_items")
      .select("id,sku,name,item_type,unit,minimum_stock,optimal_stock,serial_tracking,active,category,subcategory,manufacturer,model,barcode,warranty_months,created_at,updated_at")
      .eq("workspace_id", workspaceId).eq("active", true).order("name").limit(5000),
    supabase.from("warehouse_locations")
      .select("id,warehouse_id,parent_id,code,name,qr_token,active,created_at,updated_at")
      .eq("workspace_id", workspaceId).eq("active", true).order("code").limit(1200),
    supabase.from("stock_item_location_assignments")
      .select("id,stock_item_id,warehouse_location_id,preferred,created_at")
      .eq("workspace_id", workspaceId).limit(5000),
    supabase.from("reservations")
      .select("id,project_id,warehouse_id,stock_item_id,quantity,required_at,status")
      .eq("workspace_id", workspaceId).in("status", ["open", "pending", "reserved"]).order("required_at").limit(4000),
    supabase.from("stock_item_instances")
      .select("id,stock_item_id,serial_number,asset_tag,purchase_date,purchase_price,warranty_until,status,condition,current_warehouse_id,employee_id,project_id,vehicle_id,last_service_date,next_service_date,notes,created_at,updated_at")
      .eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(3000),
    supabase.from("price_observations")
      .select("id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,price_stage,canonical_purchase,created_at")
      .eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(6000),
    supabase.from("warehouse_ai_decision_events")
      .select("id,ai_line_id,before_decision,before_candidate_stock_item_id,before_match_confidence,before_reason,after_decision,after_candidate_stock_item_id,created_at,reverted_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(250),
    supabase.from("inventory_cost_layers")
      .select("id,warehouse_id,stock_item_id,remaining_quantity,unit_cost,received_at,recognition_mode,owner_project_id")
      .eq("workspace_id", workspaceId).gt("remaining_quantity", 0).order("received_at", { ascending: false }).limit(6000),
    supabase.from("purchase_orders")
      .select("id,project_id,counterparty_id,order_number,status,ordered_at,expected_at,currency,total_amount,notes,destination_mode,created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(250),
    getStockBalances(workspaceId),
    supabase.from("warehouse_ai_lines").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId) as unknown as Promise<CountResult>,
    supabase.from("warehouse_ai_lines").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("decision", "auto_matched") as unknown as Promise<CountResult>,
    supabase.from("warehouse_ai_lines").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("human_corrected", true) as unknown as Promise<CountResult>,
    supabase.from("material_aliases").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "approved") as unknown as Promise<CountResult>
  ]);

  const linesError = "error" in linesResult ? linesResult.error : null;
  const versionsError = "error" in versionsResult ? versionsResult.error : null;
  const textsError = "error" in textsResult ? textsResult.error : null;
  if (linesError) throw new Error(`Nie udało się załadować decyzji AI Magazynu: ${linesError.message}`);
  if (versionsError) throw new Error(`Nie udało się załadować metadanych dokumentów Magazynu: ${versionsError.message}`);
  if (textsError) throw new Error(`Nie udało się załadować podglądu tekstowego dokumentów: ${textsError.message}`);
  for (const [label, result] of [
    ["pełnego katalogu", catalogResult], ["lokalizacji", locationsResult], ["przypisań lokalizacji", assignmentsResult],
    ["rezerwacji", reservationsResult], ["sprzętu", instancesResult], ["historii cen", pricesResult],
    ["historii decyzji AI", decisionEventsResult], ["wyceny FIFO", costLayersResult], ["zamówień", purchaseOrdersResult]
  ] as const) {
    if (result.error) throw new Error(`Nie udało się załadować ${label} Magazynu: ${result.error.message}`);
  }

  const versions = "data" in versionsResult ? versionsResult.data : [];
  const texts = "data" in textsResult ? textsResult.data : [];
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

  const totalLines = totalMetric.count ?? 0;
  const autoLines = autoMetric.count ?? 0;
  const correctedLines = correctedMetric.count ?? 0;
  const aiQuality = {
    totalLines,
    autoLines,
    correctedLines,
    learnedAliases: learnedMetric.count ?? 0,
    automationRate: totalLines ? Math.round((autoLines / totalLines) * 1000) / 10 : 0,
    correctionRate: totalLines ? Math.round((correctedLines / totalLines) * 1000) / 10 : 0,
    waitingDocuments: reviewRows.filter((row) => row.status === "waiting").length
  };

  return {
    warehouseReviews: reviewRows,
    warehouseAiLines: "data" in linesResult ? linesResult.data ?? [] : [],
    warehouseDocumentPreviews,
    catalogItems: catalogResult.data ?? [],
    warehouseLocations: locationsResult.data ?? [],
    stockItemLocationAssignments: assignmentsResult.data ?? [],
    globalReservations: reservationsResult.data ?? [],
    globalStockInstances: instancesResult.data ?? [],
    globalPriceObservations: pricesResult.data ?? [],
    warehouseDecisionEvents: decisionEventsResult.data ?? [],
    inventoryCostLayers: costLayersResult.data ?? [],
    warehousePurchaseOrders: purchaseOrdersResult.data ?? [],
    globalBalances: balances.map((row) => ({ warehouse_id: row.warehouseId, stock_item_id: row.stockItemId, quantity: row.quantity })),
    warehouseAiQuality: aiQuality
  };
}
