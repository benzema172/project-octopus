import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCuratedResearch } from "../lib/ai/curated-feed-parser";
const read=(path:string)=>readFileSync(path,"utf8");

describe("Octopus Brain continuous quality infrastructure",()=>{
 it("collects feedback and document receipts idempotently without autonomous financial writes",()=>{
  const runner=read("lib/ai/brain-continuous.ts");
  const worker=read("app/api/brain/worker/route.ts");
  const migration=read("supabase/migrations/20261104144500_octopus_brain_learning_records.sql");
  expect(runner).toContain('ignoreDuplicates:true');
  expect(runner).toContain('brain_learning_events');
  expect(worker).toContain('event_key:"document:"+job.document_version_id');
  expect(migration).toContain("unique(workspace_id,event_key)");
  expect(migration).toContain("enable row level security");
  expect(migration).toContain("to service_role");
 });
 it("coordinates existing agents, retrieval and feedback only through Night Shift",()=>{
  const night=read("lib/ai/night-shift.ts");
  const service=read("lib/ai/brain-continuous.ts");
  expect(night).toContain("refreshContinuousBrain({workspaceId:input.workspaceId,referenceDate})");
  expect(service).toContain("indexWorkspaceBrain");
  expect(service).toContain("getMultiAiProviderStatus");
  expect(service).toContain('ai_consensus_events');
  expect(service).toContain('brain_agent_coordinations');
 });
 it("promotes internet content only as a user-approved, traceable pointer",()=>{
  const service=read("lib/ai/brain-continuous.ts");
  const route=read("app/api/brain/research/route.ts");
  expect(service).toContain('review_status:"pending"');
  expect(route).toContain('getRequestUser(request)');
  expect(route).toContain('domain:"reports",level:"approve"');
  const migration=read("supabase/migrations/20261104150000_brain_external_approval_atomic.sql");
  expect(route).toContain('review_brain_external_source_20261104');
  expect(migration).toContain("review_status='pending'");
  expect(migration).toContain("for update");
  expect(migration).toContain("insert into public.knowledge_entries");
  expect(migration).toContain("to service_role");
 });
 it("makes learned corrections available to RAG as examples, not autonomous decisions",()=>{
  const retrieval=read("lib/ai/brain-retrieval.ts");
  expect(retrieval).toContain('project_match_feedback');
  expect(retrieval).toContain('human_project_feedback');
  expect(retrieval).toContain('category:"decision_memory"');
  expect(retrieval).not.toContain('update({project_id');
 });
 it("rejects cross-domain, non-HTTPS, duplicates and executable content in RSS",()=>{
  const feed=`<rss><channel>
   <item><title>Zmienione przepisy &amp; normy</title><link>https://ure.gov.pl/aktualnosci/1</link></item>
   <item><title>Zmienione przepisy &amp; normy</title><link>https://ure.gov.pl/aktualnosci/1</link></item>
   <item><title>Niebezpieczne źródło</title><link>http://ure.gov.pl/aktualnosci/2</link></item>
   <item><title>Zewnętrzny portal</title><link>https://other.example/secret</link></item>
   <item><title><![CDATA[<img src=x onerror=alert(1)>]]></title><link>https://ure.gov.pl/aktualnosci/3</link></item>
   </channel></rss>`;
  const results=parseCuratedResearch(feed,"ure.gov.pl");
  expect(results.length).toBe(2);
  expect(results[0].title).toBe("Zmienione przepisy & normy");
  expect(results.every(row=>new URL(row.url).hostname==="ure.gov.pl")).toBe(true);
  expect(results[1].title).not.toContain("<img");
 });
 it("exposes distinct evidence and quality metrics with bounded database counts",()=>{
  const data=read("lib/data/brain-learning.ts");
  const ui=read("components/brain/brain-learning-dashboard.tsx");
  expect(data).toContain('count:"exact"');
  expect(data).toContain('brain_learning_events');
  expect(ui).toContain("feedback.acceptanceRate");
  expect(ui).toContain("snapshot.documents.embedded");
  expect(ui).toContain("snapshot.agents.escalations");
  expect(ui).toContain("snapshot.research.pending");
  expect(ui).toContain("Odśwież wiedzę");
  expect(ui).toContain("canRefresh");
 });
});
