import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { InvestmentAutopilotSummary } from "@/lib/data/investment-autopilot";

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

function requiredRows<T>(result: QueryResult<T>, label: string): T[] {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

export async function getReliableInvestmentAutopilotSummary(projectId: string): Promise<InvestmentAutopilotSummary> {
  const db = createServiceSupabaseClient();
  const [requirementsResult, protocolsResult, impactsResult, evidenceResult, findingsResult] = await Promise.all([
    db.from("project_requirements").select("id,title,status,requirement_type").eq("project_id", projectId).in("status", ["proposed", "required", "draft"]).limit(30),
    db.from("protocol_requirements").select("id,title,status").eq("project_id", projectId).in("status", ["required", "draft"]).limit(30),
    db.from("document_change_impacts").select("id,summary,risk_level,status").eq("project_id", projectId).eq("status", "proposed").order("created_at", { ascending: false }).limit(20),
    db.from("evidence_requirements").select("id,title,status,due_at").eq("project_id", projectId).in("status", ["missing", "submitted"]).order("due_at", { ascending: true }).limit(30),
    db.from("ai_findings").select("id,title,severity").eq("project_id", projectId).in("severity", ["critical", "warning", "high"]).limit(30)
  ]);

  const requirements = requiredRows(requirementsResult, "project_requirements");
  const protocols = requiredRows(protocolsResult, "protocol_requirements");
  const impacts = requiredRows(impactsResult, "document_change_impacts");
  const evidence = requiredRows(evidenceResult, "evidence_requirements");
  const findings = requiredRows(findingsResult, "ai_findings");

  const aiCanDoCount = requirements.filter((row) => ["material_application", "work_stage"].includes(String(row.requirement_type))).length + protocols.length;
  const blockerCount = impacts.filter((row) => ["high", "critical"].includes(String(row.risk_level).toLowerCase())).length + findings.filter((row) => String(row.severity).toLowerCase() === "critical").length;
  const attentionCount = requirements.length + protocols.length + impacts.length + evidence.length + findings.length;
  const healthScore = Math.max(0, Math.min(100, 100 - blockerCount * 10 - Math.max(0, attentionCount - aiCanDoCount) * 2));
  const nextTitle = impacts[0]?.summary ?? findings[0]?.title ?? evidence[0]?.title ?? requirements[0]?.title ?? protocols[0]?.title ?? null;

  return { attentionCount, aiCanDoCount, blockerCount, healthScore, nextTitle };
}
