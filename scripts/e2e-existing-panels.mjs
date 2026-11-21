import { createServerClient } from "@supabase/ssr";
import { verifyConstructionPanels } from "./e2e-construction-browser.mjs";

const base = process.env.E2E_BASE_URL;
const guest = await fetch(base + "/api/auth/guest", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({login: process.env.E2E_GUEST_LOGIN, password: process.env.E2E_GUEST_PASSWORD})
}).then(response => { if (!response.ok) throw Error("Audit guest unavailable"); return response.json(); });
const cookies = new Map();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {cookies:{
  getAll: () => Array.from(cookies, ([name,value])=>({name,value})),
  setAll: values => { for (const {name,value} of values) { if (value) cookies.set(name,value); else cookies.delete(name); } }
}});
const signed = await client.auth.signInWithPassword({email: guest.email, password: guest.password});
if (signed.error || !signed.data.session) throw Error("Dedicated guest sign-in failed");
const fixture = await client.from("document_versions")
  .select("project_id,documents!document_versions_document_id_fkey!inner(workspace_id)")
  .eq("documents.workspace_id",guest.workspaceId).eq("file_name","octopus-live-construction-v1-przedmiar.xlsx")
  .order("created_at",{ascending:false}).limit(1).single();
if (fixture.error || !fixture.data?.project_id) throw Error("Missing source fixture in the audit workspace");
await verifyConstructionPanels(base, fixture.data.project_id, cookies);
