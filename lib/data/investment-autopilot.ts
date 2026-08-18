import "server-only";

import { listAiInbox } from "@/lib/data/operations";
import { buildInvestmentAutopilotSnapshot, type AutopilotDecision, type AutopilotInput, type InvestmentAutopilotSnapshot } from "@/lib/investments/autopilot";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Result<T> = { data: T[] | null; error: { message: string } | null };
function rows<T>(result: Result<T>, label: string): T[] {
  if (result.error) {
    console.error("Project Octopus: investment autopilot query fallback", { label, message: result.error.message });
    return [];
  }
  return result.data ?? [];
}

export type InvestmentAutopilotSummary = {
  attentionCount: number;
  aiCanDoCount: number;
  blockerCount: number;
  healthScore: number;
  nextTitle: string | null;
  degraded: boolean;
};

export async function getInvestmentAutopilotSummary(projectId: string): Promise<InvestmentAutopilotSummary> {
  const supabase = createServiceSupabaseClient();
  const [requirements, protocols, impacts, evidence, findings] = await Promise.all([
    supabase.from("project_requirements").select("id,title,status,requirement_type").eq("project_id", projectId).in("status", ["proposed", "required", "draft"]).limit(30),
    supabase.from("protocol_requirements").select("id,title,status").eq("project_id", projectId).in("status", ["required", "draft"]).limit(30),
    supabase.from("document_change_impacts").select("id,summary,risk_level,status").eq("project_id", projectId).eq("status", "proposed").order("created_at", { ascending: false }).limit(20),
    supabase.from("evidence_requirements").select("id,title,status,due_at").eq("project_id", projectId).in("status", ["missing", "submitted"]).order("due_at", { ascending: true }).limit(30),
    // Do not send hard-coded enum literals here. Production installations may expose
    // finding_severity as an enum whose values differ from older text-based schemas.
    // We fetch a bounded set and classify severities in application code instead.
    supabase.from("ai_findings").select("id,title,severity").eq("project_id", projectId).order("created_at", { ascending: false }).limit(100)
  ]);
  const requirementRows = requirements.data ?? [];
  const protocolRows = protocols.data ?? [];
  const impactRows = impacts.data ?? [];
  const evidenceRows = evidence.data ?? [];
  const findingRows = (findings.data ?? []).filter((row) => {
    const severity = String(row.severity ?? "").toLowerCase();
    return ["critical", "high", "medium", "warning"].includes(severity);
  });
  const errors = [requirements.error, protocols.error, impacts.error, evidence.error, findings.error].filter(Boolean);
  const degraded = errors.length > 0;
  if (degraded) console.error("Project Octopus: autopilot summary partial fallback", errors.map((error) => error?.message));

  const aiCanDoCount = requirementRows.filter((row) => ["material_application", "work_stage"].includes(String(row.requirement_type))).length + protocolRows.length;
  const blockerCount = impactRows.filter((row) => ["high", "critical"].includes(String(row.risk_level).toLowerCase())).length + findingRows.filter((row) => String(row.severity).toLowerCase() === "critical").length;
  const attentionCount = requirementRows.length + protocolRows.length + impactRows.length + evidenceRows.length + findingRows.length;
  const calculatedHealth = Math.max(0, Math.min(100, 100 - blockerCount * 10 - Math.max(0, attentionCount - aiCanDoCount) * 2));
  // A partial query must never make the project look healthier than it really is.
  const healthScore = degraded ? Math.min(calculatedHealth, 60) : calculatedHealth;
  const nextTitle = degraded
    ? "Autopilot ma niepełne dane — odśwież stan przed podjęciem decyzji."
    : impactRows[0]?.summary ?? findingRows[0]?.title ?? evidenceRows[0]?.title ?? requirementRows[0]?.title ?? protocolRows[0]?.title ?? null;
  return { attentionCount, aiCanDoCount, blockerCount, healthScore, nextTitle, degraded };
}

export async function getInvestmentAutopilotSnapshot(workspaceId: string, projectId: string, options: { includeFinance?: boolean; includeWarehouse?: boolean } = {}): Promise<InvestmentAutopilotSnapshot> {
  const supabase = createServiceSupabaseClient();
  const [documentsResult,factsResult,requirementsResult,protocolRequirementsResult,protocolsResult,materialRequestsResult,scheduleResult,impactsResult,evidenceResult,findingsResult,materialsResult,devicesResult,wbsResult,boqItemsResult,boqVersionsResult,allocationsResult,movementsResult,aiInbox] = await Promise.all([
    supabase.from("documents").select("id,name,ai_status,review_status").eq("workspace_id",workspaceId).eq("project_id",projectId).is("deleted_at",null).limit(500).returns<AutopilotInput["documents"]>(),
    supabase.from("project_facts").select("id,source_reference_id,status").eq("project_id",projectId).limit(1000).returns<AutopilotInput["facts"]>(),
    supabase.from("project_requirements").select("id,requirement_type,title,description,status,confidence,source_document_id").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(500).returns<AutopilotInput["requirements"]>(),
    supabase.from("protocol_requirements").select("id,protocol_type,title,status,trigger_rule,required_evidence").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(500).returns<AutopilotInput["protocolRequirements"]>(),
    supabase.from("protocols").select("id,protocol_type,title,status,payload").eq("project_id",projectId).limit(500).returns<AutopilotInput["protocols"]>(),
    supabase.from("material_requests").select("id,title,status,payload").eq("project_id",projectId).limit(500).returns<AutopilotInput["materialRequests"]>(),
    supabase.from("schedule_activities").select("id,code,title,status,planned_start,planned_finish,actual_finish,critical,wbs_node_id").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(1000).returns<AutopilotInput["scheduleActivities"]>(),
    supabase.from("document_change_impacts").select("id,summary,risk_level,target_type,status,created_at").eq("workspace_id",workspaceId).eq("project_id",projectId).order("created_at",{ascending:false}).limit(200).returns<AutopilotInput["impacts"]>(),
    supabase.from("evidence_requirements").select("id,evidence_type,title,status,due_at,wbs_node_id").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(500).returns<AutopilotInput["evidence"]>(),
    supabase.from("ai_findings").select("id,finding_type,severity,title,description").eq("project_id",projectId).limit(300).returns<AutopilotInput["findings"]>(),
    supabase.from("materials").select("id,name,installation,specification").eq("project_id",projectId).limit(500).returns<AutopilotInput["materials"]>(),
    supabase.from("devices").select("id,name,installation,parameters").eq("project_id",projectId).limit(500).returns<AutopilotInput["devices"]>(),
    supabase.from("wbs_nodes").select("id,code,name,installation,status").eq("workspace_id",workspaceId).eq("project_id",projectId).order("sort_order",{ascending:true}).limit(500).returns<AutopilotInput["wbsNodes"]>(),
    supabase.from("boq_items").select("id,item_number,description,quantity,quantity_executed,quantity_accepted,unit,unit_price,total_price,wbs_node_id").eq("project_id",projectId).limit(2000).returns<AutopilotInput["boqItems"]>(),
    supabase.from("boq_versions").select("id,status,version_number").eq("workspace_id",workspaceId).eq("project_id",projectId).order("version_number",{ascending:false}).limit(50).returns<AutopilotInput["boqVersions"]>(),
    options.includeFinance ? supabase.from("financial_allocations").select("id,source_type,source_id,amount,status").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(1000).returns<NonNullable<AutopilotInput["finance"]>["allocations"]>() : Promise.resolve({data:[],error:null}),
    options.includeWarehouse ? supabase.from("stock_movements").select("id,movement_type,document_number,movement_date,status").eq("workspace_id",workspaceId).eq("project_id",projectId).limit(1000).returns<NonNullable<AutopilotInput["warehouse"]>["movements"]>() : Promise.resolve({data:[],error:null}),
    listAiInbox(workspaceId).catch(()=>[])
  ]);
  const allocations=rows(allocationsResult as Result<NonNullable<AutopilotInput["finance"]>["allocations"][number]>,"financial_allocations"),movements=rows(movementsResult as Result<NonNullable<AutopilotInput["warehouse"]>["movements"][number]>,"stock_movements");
  const invoiceIds=Array.from(new Set(allocations.filter((row)=>row.source_type==="invoice").map((row)=>row.source_id))),movementIds=movements.map((row)=>row.id);
  const [invoicesResult,invoiceLinesResult,movementLinesResult]=await Promise.all([
    options.includeFinance&&invoiceIds.length?supabase.from("invoices").select("id,invoice_number,direction,net_amount,status").eq("workspace_id",workspaceId).in("id",invoiceIds).returns<NonNullable<AutopilotInput["finance"]>["invoices"]>():Promise.resolve({data:[],error:null}),
    options.includeFinance&&invoiceIds.length?supabase.from("invoice_lines").select("invoice_id,description,quantity,unit,net_amount").eq("workspace_id",workspaceId).in("invoice_id",invoiceIds).returns<NonNullable<AutopilotInput["finance"]>["invoiceLines"]>():Promise.resolve({data:[],error:null}),
    options.includeWarehouse&&movementIds.length?supabase.from("stock_movement_lines").select("movement_id,stock_item_id,quantity,unit_cost").eq("workspace_id",workspaceId).in("movement_id",movementIds).returns<NonNullable<AutopilotInput["warehouse"]>["movementLines"]>():Promise.resolve({data:[],error:null})
  ]);
  const movementLines=rows(movementLinesResult as Result<NonNullable<AutopilotInput["warehouse"]>["movementLines"][number]>,"stock_movement_lines"),stockItemIds=Array.from(new Set(movementLines.map((row)=>row.stock_item_id)));
  const stockItemsResult=options.includeWarehouse&&stockItemIds.length?await supabase.from("stock_items").select("id,name,sku,item_type,unit").eq("workspace_id",workspaceId).in("id",stockItemIds).returns<NonNullable<AutopilotInput["warehouse"]>["stockItems"]>():{data:[],error:null};
  const decisions:AutopilotDecision[]=aiInbox.filter((item)=>item.projectId===projectId).map((item)=>({id:item.id,title:item.title,subtitle:item.subtitle,status:item.status,confidence:item.confidence,category:item.category,detail:item.detail}));
  const input:AutopilotInput={nowIso:new Date().toISOString(),projectId,workspaceId,documents:rows(documentsResult,"documents"),facts:rows(factsResult,"project_facts"),requirements:rows(requirementsResult,"project_requirements"),protocolRequirements:rows(protocolRequirementsResult,"protocol_requirements"),protocols:rows(protocolsResult,"protocols"),materialRequests:rows(materialRequestsResult,"material_requests"),scheduleActivities:rows(scheduleResult,"schedule_activities"),impacts:rows(impactsResult,"document_change_impacts"),evidence:rows(evidenceResult,"evidence_requirements"),findings:rows(findingsResult,"ai_findings"),materials:rows(materialsResult,"materials"),devices:rows(devicesResult,"devices"),wbsNodes:rows(wbsResult,"wbs_nodes"),boqItems:rows(boqItemsResult,"boq_items"),boqVersions:rows(boqVersionsResult,"boq_versions"),aiDecisions:decisions,finance:options.includeFinance?{allocations,invoices:rows(invoicesResult as Result<NonNullable<AutopilotInput["finance"]>["invoices"][number]>,"invoices"),invoiceLines:rows(invoiceLinesResult as Result<NonNullable<AutopilotInput["finance"]>["invoiceLines"][number]>,"invoice_lines")}:null,warehouse:options.includeWarehouse?{movements,movementLines,stockItems:rows(stockItemsResult as Result<NonNullable<AutopilotInput["warehouse"]>["stockItems"][number]>,"stock_items")}:null};
  return buildInvestmentAutopilotSnapshot(input);
}
