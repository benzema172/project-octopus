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
const projects = await client.from("projects").select("id").eq("workspace_id",guest.workspaceId).eq("status","active").limit(1);
if (projects.error || !projects.data?.[0]) throw Error("Missing audit investment");
await verifyConstructionPanels(base, projects.data[0].id, cookies);
