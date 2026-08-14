import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

const LEVELS = { read: 1, write: 2, approve: 3, admin: 4 } as const;
type AccessLevel = keyof typeof LEVELS;

export async function hasDomainAccess(input: {
  workspaceId: string;
  userId: string;
  domain: "investments" | "finance" | "hr" | "warehouse" | "fleet" | "templates" | "reports" | "settings";
  level?: AccessLevel;
  projectId?: string | null;
}) {
  const supabase = createServiceSupabaseClient();
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", input.workspaceId).eq("user_id", input.userId).maybeSingle<{ role: string }>();
  if (["owner", "admin"].includes(membership?.role ?? "")) return true;
  const { data: grants } = await supabase
    .from("domain_role_grants")
    .select("access_level,project_id,valid_from,valid_until")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("domain", input.domain)
    .lte("valid_from", new Date().toISOString())
    .returns<Array<{ access_level: AccessLevel; project_id: string | null; valid_from: string; valid_until: string | null }>>();
  const required = LEVELS[input.level ?? "read"];
  const now = Date.now();
  return (grants ?? []).some((grant) => {
    const active = !grant.valid_until || Date.parse(grant.valid_until) >= now;
    const projectMatches = !grant.project_id || grant.project_id === input.projectId;
    return active && projectMatches && (LEVELS[grant.access_level] ?? 0) >= required;
  });
}

export function domainForDocumentCategory(category: string | null | undefined) {
  if (category === "invoice") return "finance" as const;
  if (category === "hr") return "hr" as const;
  if (category === "fleet") return "fleet" as const;
  if (category === "warehouse") return "warehouse" as const;
  if (category === "template") return "templates" as const;
  if (category === "report") return "reports" as const;
  return "investments" as const;
}
