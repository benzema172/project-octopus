import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type BrainResearchItem={
 id:string;title:string;source_name:string;source_url:string;observed_at:string;review_status:string;
};
export type BrainLearningSnapshot={
 feedback:{total:number;accepted:number;corrected:number;rejected:number;acceptanceRate:number|null};
 research:{pending:number;approved:number;items:BrainResearchItem[]};
 documents:{chunks:number;embedded:number;missingEmbeddings:number};
 agents:{reviews:number;escalations:number;providers:string[];lastRun:string|null;warnings:string[]};
};

export async function getBrainLearningSnapshot(workspaceId:string):Promise<BrainLearningSnapshot>{
 const db=createServiceSupabaseClient();
 const [
  eventResult, sourceResult, sourceApprovedResult, sourceItemsResult, documentResult,
  consensusResult, coordResult
 ]=await Promise.all([
  db.from("brain_learning_events").select("outcome").eq("workspace_id",workspaceId).limit(5000),
  db.from("brain_external_observations").select("id",{head:true,count:"exact"}).eq("workspace_id",workspaceId).eq("review_status","pending"),
  db.from("brain_external_observations").select("id",{head:true,count:"exact"}).eq("workspace_id",workspaceId).eq("review_status","approved"),
  db.from("brain_external_observations").select("id,title,source_name,source_url,observed_at,review_status").eq("workspace_id",workspaceId)
   .eq("review_status","pending").order("observed_at",{ascending:false}).limit(8).returns<BrainResearchItem[]>(),
  db.from("documents").select("current_version_id").eq("workspace_id",workspaceId).is("deleted_at",null)
   .not("current_version_id","is",null).limit(500),
  db.from("ai_consensus_events").select("requires_human").eq("workspace_id",workspaceId)
   .order("created_at",{ascending:false}).limit(500),
  db.from("brain_agent_coordinations").select("providers,warnings,created_at").eq("workspace_id",workspaceId)
   .order("reference_date",{ascending:false}).limit(1).maybeSingle()
 ]);
 const errors=[eventResult.error,sourceResult.error,sourceApprovedResult.error,sourceItemsResult.error,
  documentResult.error,consensusResult.error,coordResult.error].filter(Boolean);
 if(errors.length)throw new Error("Nie można odczytać pełnej pamięci Brain: "+errors[0]?.message);
 const events=eventResult.data??[];
 const ids=Array.from(new Set((documentResult.data??[]).map(row=>row.current_version_id).filter((id):id is string=>Boolean(id))));
 let chunks=0,embedded=0;
 for(let i=0;i<ids.length;i+=100){
  const [totalCount, embeddedCount]=await Promise.all([
   db.from("document_chunks").select("id",{head:true,count:"exact"}).in("document_version_id",ids.slice(i,i+100)),
   db.from("document_chunks").select("id",{head:true,count:"exact"}).in("document_version_id",ids.slice(i,i+100)).not("embedding_vector","is",null)
  ]);
  if(totalCount.error||embeddedCount.error)throw new Error(totalCount.error?.message??embeddedCount.error?.message);
  chunks+=totalCount.count??0;embedded+=embeddedCount.count??0;
 }
 const accepted=events.filter(row=>row.outcome==="accepted").length;
 const corrected=events.filter(row=>row.outcome==="corrected").length;
 const rejected=events.filter(row=>row.outcome==="rejected").length;
 const judged=accepted+corrected+rejected;
 const council=consensusResult.data??[];
 const providers=Array.isArray(coordResult.data?.providers) ?
  coordResult.data.providers.filter((v):v is string=>typeof v==="string"):[];
 const warnings=Array.isArray(coordResult.data?.warnings)?
  coordResult.data.warnings.filter((v):v is string=>typeof v==="string").slice(0,5):[];
 return {
  feedback:{total:events.length,accepted,corrected,rejected,acceptanceRate:judged?accepted/judged:null},
  research:{pending:sourceResult.count??0,approved:sourceApprovedResult.count??0,items:sourceItemsResult.data??[]},
  documents:{chunks,embedded,missingEmbeddings:Math.max(0,chunks-embedded)},
  agents:{reviews:council.length,escalations:council.filter(row=>row.requires_human===true).length,
   providers,lastRun:coordResult.data?.created_at??null,warnings}
 };
}
