import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type CompanyActionItem = {
  itemKey: string;
  domain: string;
  severity: "critical" | "high" | "warning" | "info" | string;
  priority: number;
  title: string;
  detail: string | null;
  projectId: string | null;
  entityType: string;
  entityId: string;
  href: string | null;
  dueAt: string | null;
  amount: number | null;
  createdAt: string;
};

type RpcRow = {
  item_key: string;
  domain: string;
  severity: string;
  priority: number;
  title: string;
  detail: string | null;
  project_id: string | null;
  entity_type: string;
  entity_id: string;
  href: string | null;
  due_at: string | null;
  amount: number | null;
  created_at: string;
};

export async function getCompanyActionCenter(workspaceId: string, limit = 80): Promise<CompanyActionItem[]> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("get_company_action_center", {
    p_workspace_id: workspaceId,
    p_limit: Math.min(200, Math.max(1, limit))
  });
  if (error) throw new Error(`Nie udało się pobrać kolejki działań: ${error.message}`);
  return ((data ?? []) as RpcRow[]).map((row) => ({
    itemKey: row.item_key,
    domain: row.domain,
    severity: row.severity,
    priority: Number(row.priority ?? 0),
    title: row.title,
    detail: row.detail,
    projectId: row.project_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    href: row.href,
    dueAt: row.due_at,
    amount: row.amount == null ? null : Number(row.amount),
    createdAt: row.created_at
  }));
}

export async function refreshOperationalNotifications(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("refresh_operational_notifications_atomic", { p_workspace_id: workspaceId });
  if (error) throw new Error(`Nie udało się odświeżyć alertów: ${error.message}`);
  return data;
}
