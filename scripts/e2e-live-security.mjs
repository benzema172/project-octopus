import { createClient } from "@supabase/supabase-js";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "E2E_BASE_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing live security configuration: ${missing.join(", ")}`);

const baseUrl = process.env.E2E_BASE_URL.replace(/\/$/, "");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function api(path, { token, body, method } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

const guest = await api("/api/auth/guest", {
  method: "POST",
  body: { login: "gosc", password: "gosc" }
});
if (!guest.response.ok) throw new Error(`Guest bootstrap failed: ${guest.response.status} ${JSON.stringify(guest.payload)}`);

const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
  email: guest.payload.email,
  password: guest.payload.password
});
if (signInError || !session.session) throw new Error(`Guest sign-in failed: ${signInError?.message ?? "missing session"}`);

const token = session.session.access_token;
const workspaceId = guest.payload.workspaceId;

const [{ data: foreignWorkspaces, error: workspaceError }, { data: foreignProjects, error: projectError }, { data: foreignDocuments, error: documentError }] = await Promise.all([
  supabase.from("workspaces").select("id").neq("id", workspaceId).limit(1),
  supabase.from("projects").select("id,workspace_id").neq("workspace_id", workspaceId).limit(1),
  supabase.from("documents").select("id,workspace_id").neq("workspace_id", workspaceId).limit(1)
]);

if (workspaceError || projectError || documentError) {
  throw new Error(`RLS isolation query failed: ${workspaceError?.message ?? projectError?.message ?? documentError?.message}`);
}
if (foreignWorkspaces?.length || foreignProjects?.length || foreignDocuments?.length) {
  throw new Error(`Tenant isolation breach: ${JSON.stringify({ foreignWorkspaces, foreignProjects, foreignDocuments })}`);
}

const randomWorkspace = "11111111-1111-4111-8111-111111111111";
const crossWorkspace = await api(`/api/company/search?workspaceId=${randomWorkspace}&q=Octopus`, { token });
if (![403, 404].includes(crossWorkspace.response.status)) {
  throw new Error(`Cross-workspace API guard failed: expected 403/404, got ${crossWorkspace.response.status}`);
}

const randomProject = "22222222-2222-4222-8222-222222222222";
const crossProject = await api(`/api/projects/command-center?projectId=${randomProject}`, { token });
if (![403, 404].includes(crossProject.response.status)) {
  throw new Error(`Cross-project API guard failed: expected 403/404, got ${crossProject.response.status}`);
}

console.log("LIVE PRODUCTION SECURITY E2E OK");
console.log(JSON.stringify({ workspaceId, tenantIsolation: true, crossWorkspaceGuard: true, crossProjectGuard: true }));
