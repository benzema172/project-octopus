import "server-only";

import type { AiInboxItem } from "@/lib/data/operations";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type IntakeRow={id:string;document_id:string;proposed_project_id:string|null;status:string;suggested_category:string|null;confidence:number|null;created_at:string;documents:{name?:string;ai_status?:string;project_id?:string|null}|Array<{name?:string;ai_status?:string;project_id?:string|null}>|null};

function status(value:string,aiStatus?:string):AiInboxItem["status"]{const v=aiStatus==="error"?"error":value;if(["queued","pending","new"].includes(v))return"new";if(["running","processing","extract","analyze"].includes(v))return"processing";if(["review","proposed","mapping"].includes(v))return"review";if(["error","failed","dead_letter"].includes(v))return"error";if(["ready","approved","succeeded","complete"].includes(v))return"ready";if(v==="rejected")return"rejected";return"new";}

export async function listProjectAiInbox(workspaceId:string,projectId:string,limit=80):Promise<AiInboxItem[]>{
  const db=createServiceSupabaseClient();
  const projectDocuments=await db.from("documents").select("id").eq("workspace_id",workspaceId).eq("project_id",projectId).is("deleted_at",null).limit(500);
  if(projectDocuments.error)throw new Error(`Nie udało się ustalić dokumentów inwestycji dla AI Inbox: ${projectDocuments.error.message}`);
  const documentIds=(projectDocuments.data??[]).map(row=>String(row.id));
  const intakeQueries=[
    db.from("document_intakes").select("id,document_id,proposed_project_id,status,suggested_category,confidence,created_at,documents(name,ai_status,project_id)").eq("workspace_id",workspaceId).eq("proposed_project_id",projectId).order("created_at",{ascending:false}).limit(30).returns<IntakeRow[]>()
  ];
  if(documentIds.length)intakeQueries.push(db.from("document_intakes").select("id,document_id,proposed_project_id,status,suggested_category,confidence,created_at,documents(name,ai_status,project_id)").eq("workspace_id",workspaceId).in("document_id",documentIds).order("created_at",{ascending:false}).limit(30).returns<IntakeRow[]>());
  const [intakeResults,estimates,impacts,siteEvents,knowledge]=await Promise.all([
    Promise.all(intakeQueries),
    db.from("estimate_imports").select("id,project_id,status,detected_rows,accepted_rows,created_at").eq("workspace_id",workspaceId).eq("project_id",projectId).in("status",["mapping","review","error"]).order("created_at",{ascending:false}).limit(20),
    db.from("document_change_impacts").select("id,project_id,status,impact_type,target_type,summary,risk_level,created_at").eq("workspace_id",workspaceId).eq("project_id",projectId).eq("status","proposed").order("created_at",{ascending:false}).limit(20),
    db.from("site_events").select("id,project_id,status,event_type,title,description,created_at").eq("workspace_id",workspaceId).eq("project_id",projectId).eq("status","draft").order("created_at",{ascending:false}).limit(20),
    db.from("knowledge_entries").select("id,source_project_id,entry_type,title,summary,status,created_at").eq("workspace_id",workspaceId).eq("source_project_id",projectId).eq("status","proposed").order("created_at",{ascending:false}).limit(20)
  ]);
  for(const result of [...intakeResults,estimates,impacts,siteEvents,knowledge])if(result.error)throw new Error(`Projektowy AI Inbox nie może odczytać danych: ${result.error.message}`);
  const intakeMap=new Map<string,IntakeRow>();for(const result of intakeResults)for(const row of result.data??[])intakeMap.set(String(row.id),row);
  const items:AiInboxItem[]=[];
  for(const row of intakeMap.values()){const document=Array.isArray(row.documents)?row.documents[0]:row.documents;items.push({id:row.document_id,entityType:"document",projectId:document?.project_id??row.proposed_project_id,title:document?.name??"Dokument bez nazwy",subtitle:"Klasyfikacja i Project DNA",status:status(row.status,document?.ai_status),confidence:row.confidence,category:row.suggested_category??"nierozpoznana",createdAt:row.created_at,detail:row.status==="review"?"Sprawdź kategorię, inwestycję i fakty przed zatwierdzeniem.":"Dokument przechodzi wspólny pipeline AI."});}
  for(const row of estimates.data??[])items.push({id:String(row.id),entityType:"estimate_import",projectId:projectId,title:`Import kosztorysu — ${row.detected_rows??0} pozycji`,subtitle:"BOQ / WBS",status:status(String(row.status)),confidence:null,category:"estimate",createdAt:String(row.created_at),detail:`${row.accepted_rows??0} zaakceptowanych. Zatwierdzenie utworzy wersję BOQ, WBS i szkic harmonogramu.`});
  for(const row of impacts.data??[])items.push({id:String(row.id),entityType:"change_impact",projectId,title:String(row.summary),subtitle:`Radar zmiany · ${row.target_type}`,status:"review",confidence:null,category:String(row.impact_type),createdAt:String(row.created_at),detail:`Ryzyko: ${row.risk_level}. Zmiana nie aktualizuje danych bez decyzji.`});
  for(const row of siteEvents.data??[])items.push({id:String(row.id),entityType:"site_event",projectId,title:String(row.title),subtitle:"Zdarzenie z budowy",status:"review",confidence:null,category:String(row.event_type),createdAt:String(row.created_at),detail:String(row.description??"Wymaga zatwierdzenia kierownika.")});
  for(const row of knowledge.data??[])items.push({id:String(row.id),entityType:"knowledge_entry",projectId,title:String(row.title),subtitle:"Pamięć organizacji",status:"review",confidence:null,category:String(row.entry_type),createdAt:String(row.created_at),detail:String(row.summary)});
  return items.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,Math.max(1,Math.min(200,limit)));
}
