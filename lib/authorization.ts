import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { normalizeDocumentCategory } from "@/lib/documents/classification";

const LEVELS = { read: 1, write: 2, approve: 3, admin: 4 } as const;
export type AccessLevel = keyof typeof LEVELS;
export type Domain = "investments" | "finance" | "hr" | "warehouse" | "fleet" | "templates" | "reports" | "settings";

type DomainGrant = { domain: Domain; access_level: AccessLevel; project_id: string | null; valid_from: string; valid_until: string | null };
export type DomainAccessPolicy = { administrator: boolean; grants: DomainGrant[] };

const cachedDomainAccessPolicy = cache(async (workspaceId: string, userId: string): Promise<DomainAccessPolicy> => {
  const supabase = createServiceSupabaseClient();
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle<{ role: string }>();
  if (["owner", "admin"].includes(membership?.role ?? "")) return { administrator: true, grants: [] };
  if (!membership) return { administrator: false, grants: [] };
  const { data: grants } = await supabase.from("domain_role_grants").select("domain,access_level,project_id,valid_from,valid_until").eq("workspace_id", workspaceId).eq("user_id", userId).lte("valid_from", new Date().toISOString()).returns<DomainGrant[]>();
  return { administrator: false, grants: grants ?? [] };
});

export function loadDomainAccessPolicy(input: { workspaceId: string; userId: string }) {
  return cachedDomainAccessPolicy(input.workspaceId, input.userId);
}

export function domainAccessPolicyAllows(policy: DomainAccessPolicy, input: { domain: Domain; level?: AccessLevel; projectId?: string | null }) {
  if (policy.administrator) return true;
  const required = LEVELS[input.level ?? "read"];
  const now = Date.now();
  return policy.grants.some((grant) => {
    const active = !grant.valid_until || Date.parse(grant.valid_until) >= now;
    const projectMatches = !grant.project_id || grant.project_id === input.projectId;
    return active && grant.domain === input.domain && projectMatches && (LEVELS[grant.access_level] ?? 0) >= required;
  });
}

export function domainAccessPolicyHasAnyScope(policy: DomainAccessPolicy, input: { domain: Domain; level?: AccessLevel }) {
  if (policy.administrator) return true;
  const required = LEVELS[input.level ?? "read"];
  const now = Date.now();
  return policy.grants.some((grant) => grant.domain === input.domain && (!grant.valid_until || Date.parse(grant.valid_until) >= now) && (LEVELS[grant.access_level] ?? 0) >= required);
}

export async function hasDomainAccess(input: { workspaceId: string; userId: string; domain: Domain; level?: AccessLevel; projectId?: string | null }) {
  const policy = await loadDomainAccessPolicy({ workspaceId: input.workspaceId, userId: input.userId });
  return domainAccessPolicyAllows(policy, input);
}

export function domainForDocumentCategory(category: string | null | undefined) {
  const normalized = normalizeDocumentCategory(category);
  if (normalized === "invoice") return "finance" as const;
  if (normalized === "hr") return "hr" as const;
  if (normalized === "fleet") return "fleet" as const;
  if (normalized === "warehouse") return "warehouse" as const;
  if (normalized === "template") return "templates" as const;
  if (normalized === "report") return "reports" as const;
  return "investments" as const;
}
