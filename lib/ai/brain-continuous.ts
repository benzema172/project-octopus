import "server-only";

import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { indexWorkspaceBrain } from "@/lib/ai/brain-retrieval";
import { getMultiAiProviderStatus } from "@/lib/ai/provider-vault";

type Row = Record<string, unknown>;
type BrainResult = {
 feedback: { captured: number; total: number; corrected: number; accepted: number; rejected: number };
 documents: { indexed: number; failed: number };
 research: { candidates: number; failures: string[] };
 council: { reviews: number; escalations: number; configuredProviders: string[] };
};

const SAFE_RESEARCH_FEEDS = [
 { name: "Zamówienia publiczne", url: "https://www.uzp.gov.pl/aktualnosci/rss" },
 { name: "Informacje rządowe", url: "https://www.gov.pl/web/rozwoj-technologia/aktualnosci" }
] as const;

const truncate = (value: unknown, max = 350) => String(value ?? "").trim().slice(0, max);
function xmlEntities(value: string) {
 return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, "&").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function safeLink(value: string, host: string): string | null {
 try {
  const parsed = new URL(xmlEntities(value));
  if (parsed.protocol !== "https:" || parsed.hostname !== host || parsed.username || parsed.password) return null;
  parsed.hash = "";
  return parsed.toString();
 } catch { return null; }
}
/** Feed links are untrusted candidates, never executable instructions or approved company knowledge. */
export function parseCuratedResearch(feed: string, sourceHost: string) {
 const entries: Array<{ url: string; title: string }> = [];
 const blocks = feed.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
 for (const block of blocks.slice(0, 15)) {
  const title = xmlEntities(block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const link = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1]
   ?? block.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1] ?? "";
  const url = safeLink(link, sourceHost);
  if (!url || !title || entries.some(entry=>entry.url===url)) continue;
  entries.push({ url, title: truncate(title, 200) });
 }
 return entries;
}

async function captureHumanFeedback(workspaceId: string) {
 const db = createServiceSupabaseClient();
 const [reviews, matches] = await Promise.all([
  db.from("ai_review_actions")
   .select("id,document_id,entity_type,action,project_id,created_at")
   .eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(250),
  db.from("project_match_feedback")
   .select("id,document_id,proposed_project_id,selected_project_id,outcome,decided_at")
   .eq("workspace_id",workspaceId).order("decided_at",{ascending:false}).limit(250)
 ]);
 if (reviews.error) throw new Error(reviews.error.message);
 if (matches.error) throw new Error(matches.error.message);
 const observations = [
  ...((reviews.data ?? []) as Row[]).map(row=>({
   workspace_id:workspaceId,document_id:row.document_id ?? null,event_key:"review:"+row.id,
   origin:"human_review",
   outcome:["approve","approved","accept","accepted"].includes(String(row.action))?"accepted":
    ["reject","rejected"].includes(String(row.action))?"rejected":"corrected",
   context:{entity_type:row.entity_type,action:row.action,project_id:row.project_id}
  })),
  ...((matches.data ?? []) as Row[]).map(row=>({
   workspace_id:workspaceId,document_id:row.document_id ?? null,event_key:"project_match:"+row.id,
   origin:"project_match",
   outcome:String(row.outcome)==="confirmed"?"accepted":String(row.outcome)==="rejected"?"rejected":"corrected",
   context:{proposed_project_id:row.proposed_project_id,selected_project_id:row.selected_project_id}
  }))
 ];
 let captured=0;
 for(let i=0;i<observations.length;i+=75){
  const { error }=await db.from("brain_learning_events").upsert(observations.slice(i,i+75),{onConflict:"workspace_id,event_key",ignoreDuplicates:true});
  if(error)throw new Error(error.message);
  captured+=observations.slice(i,i+75).length;
 }
 const { data, error }=await db.from("brain_learning_events").select("outcome").eq("workspace_id",workspaceId).limit(10000);
 if(error)throw new Error(error.message);
 const items=data ?? [];
 return {captured,total:items.length,corrected:items.filter(x=>x.outcome==="corrected").length,
  accepted:items.filter(x=>x.outcome==="accepted").length,rejected:items.filter(x=>x.outcome==="rejected").length};
}

async function retrieveCuratedResearch(workspaceId: string) {
 const db=createServiceSupabaseClient();
 const failures:string[]=[];
 let candidates=0;
 for (const source of SAFE_RESEARCH_FEEDS) {
  try {
   const response=await fetch(source.url,{headers:{Accept:"application/rss+xml, application/atom+xml, application/xml"},
    signal:AbortSignal.timeout(7000),redirect:"error",cache:"no-store"});
   if(!response.ok)throw new Error("HTTP "+response.status);
   const length=Number(response.headers.get("content-length")??0);
   if(length>180000)throw new Error("Oversized source");
   const body=(await response.text()).slice(0,180000);
   const articles=parseCuratedResearch(body,new URL(source.url).hostname);
   if(!articles.length)throw new Error("No verified feed entries");
   const records=articles.map(item=>({
    workspace_id:workspaceId,source_name:source.name,source_url:item.url,
    url_fingerprint:createHash("sha256").update(item.url).digest("hex"),
    title:item.title,summary:"Zewnętrzne źródło: wymaga weryfikacji przed wykorzystaniem przez AI.",
    review_status:"pending",metadata:{feed:source.url}
   }));
   const {error}=await db.from("brain_external_observations").upsert(records,{onConflict:"workspace_id,url_fingerprint",ignoreDuplicates:true});
   if(error)throw new Error(error.message);
   candidates+=records.length;
  }catch(error){failures.push(source.name+": "+(error instanceof Error?error.message:"błąd pobierania"));}
 }
 return {candidates,failures};
}
async function summarizeCouncil(workspaceId: string) {
 const db=createServiceSupabaseClient();
 const [{data, error}, status]=await Promise.all([
  db.from("ai_consensus_events").select("requires_human,providers")
   .eq("workspace_id",workspaceId).order("created_at",{ascending:false}).limit(100),
  getMultiAiProviderStatus(workspaceId)
 ]);
 if(error)throw new Error(error.message);
 return {reviews:data?.length??0,escalations:(data??[]).filter(row=>row.requires_human).length,
  configuredProviders:["gemini",...(status.groq.configured?["groq"]:[]),...(status.cloudflare.configured?["cloudflare"]:[])]};
}

/** Safe, bounded nightly coordination. Never publishes external sources or changes financial/stock data. */
export async function refreshContinuousBrain(input:{workspaceId:string;referenceDate:string}):Promise<BrainResult>{
 const db=createServiceSupabaseClient();
 const [feedbackResult,indexResult,researchResult,councilResult]=await Promise.allSettled([
  captureHumanFeedback(input.workspaceId),
  indexWorkspaceBrain({workspaceId:input.workspaceId,limit:25}),
  retrieveCuratedResearch(input.workspaceId),
  summarizeCouncil(input.workspaceId)
 ]);
 const feedback=feedbackResult.status==="fulfilled"?feedbackResult.value:{captured:0,total:0,corrected:0,accepted:0,rejected:0};
 const documents=indexResult.status==="fulfilled"?indexResult.value:{indexed:0,failed:1};
 const research=researchResult.status==="fulfilled"?researchResult.value:{candidates:0,failures:[String(researchResult.reason)]};
 const council=councilResult.status==="fulfilled"?councilResult.value:{reviews:0,escalations:0,configuredProviders:[]};
 const warnings=[
  ...[feedbackResult,indexResult,councilResult].filter(r=>r.status==="rejected").map(r=>String((r as PromiseRejectedResult).reason).slice(0,180)),
  ...research.failures
 ];
 const {error}=await db.from("brain_agent_coordinations").upsert({
  workspace_id:input.workspaceId,reference_date:input.referenceDate,scope:"night_shift",
  providers:council.configuredProviders,indexing:documents,feedback_count:feedback.total,
  warnings
 },{onConflict:"workspace_id,reference_date,scope"});
 if(error)throw new Error("Nie można zapisać audytu Brain: "+error.message);
 return {feedback,documents,research,council};
}
