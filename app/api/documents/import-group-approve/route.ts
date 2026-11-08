import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { runInvestmentAutopilot } from "@/lib/investments/run-autopilot";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Body={
  workspaceId:string;sessionId:string;projectId:string;
  module:string;proposalType:string;proposalIds:string[];
  confirm?:boolean;
};
const isUuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(s);
const reply=(message:string,status:number)=>NextResponse.json({error:message},{
  status,headers:{"Cache-Control":"no-store"}
});

/** One explicit human click per verified group.
 * This route never changes journal approval or stock movement status.
 * The existing atomic publication RPC still validates each module effect.
 */
export async function POST(request:Request) {
  const user=await getRequestUser(request);
  if(!user)return reply("Brak aktywnej sesji.",401);
  let body:Body;
  try{body=await request.json() as Body;}catch{return reply("Nieprawidłowe dane decyzji.",400);}
  const ids=[...new Set(Array.isArray(body.proposalIds)?body.proposalIds:[])];
  if(body.confirm!==true || !isUuid(body.workspaceId??"") || !isUuid(body.sessionId??"")
    || !isUuid(body.projectId??"") || !body.module || !body.proposalType
    || ids.length<1 || ids.length>20 || ids.some(id=>!isUuid(id)))
    return reply("Wybierz od 1 do 20 potwierdzonych propozycji tej samej grupy.",400);
  const [workspace,project]=await Promise.all([
    getWorkspaceForUser(user,body.workspaceId),
    getProjectForUser(user,body.projectId)
  ]);
  if(!workspace || !project || project.workspace_id!==workspace.id)
    return reply("Brak dostępu do inwestycji i firmy.",403);
  if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,
    domain:"investments",level:"approve",projectId:project.id}))
    return reply("Brak uprawnień do publikowania propozycji.",403);
  const db=createServiceSupabaseClient();
  const {data:session,error:sessionError}=await db.from("document_import_sessions")
    .select("id").eq("id",body.sessionId).eq("workspace_id",workspace.id).maybeSingle();
  if(sessionError||!session)return reply("Sesja importu nie należy do tej firmy.",404);
  const [{data:rows,error:readError},{data:sessionVersions,error:versionError}]=await Promise.all([
    db.from("document_module_proposals")
      .select("id,document_id,document_version_id,project_id,module,proposal_type,status,confidence,source_quote,source_locator,payload")
      .eq("workspace_id",workspace.id).eq("project_id",project.id)
      .eq("module",body.module).eq("proposal_type",body.proposalType)
      .eq("status","proposed").in("id",ids),
    db.from("document_import_session_items").select("document_version_id")
      .eq("workspace_id",workspace.id).eq("session_id",body.sessionId)
      .not("document_version_id","is",null).limit(300)
  ]);
  if(readError||versionError)return reply("Nie udało się sprawdzić źródeł grupy.",500);
  const versionIds=new Set((sessionVersions??[]).map(v=>v.document_version_id));
  if((rows??[]).length!==ids.length
    || (rows??[]).some(r=>!versionIds.has(r.document_version_id)
      || (r.payload?.fieldQuality as {requiresReview?:boolean}|undefined)?.requiresReview===true
      || Number(r.confidence??0)<0.90
      || !(String(r.source_quote??"").trim()
        || (r.source_locator && Object.keys(r.source_locator).length>0))))
    return reply("Grupa zawiera niezaufane, niekompletne lub zmienione propozycje.",409);
  const documentIds=[...new Set((rows??[]).map(r=>r.document_id))];
  const {count:approved,error:approvalError}=await db.from("documents")
    .select("id",{count:"exact",head:true})
    .eq("workspace_id",workspace.id).eq("project_id",project.id)
    .eq("review_status","approved").is("deleted_at",null).in("id",documentIds);
  if(approvalError||approved!==documentIds.length)
    return reply("Najpierw zatwierdź dokumenty źródłowe i ich przypisanie do inwestycji.",409);

  const results:Array<{id:string;status:string;error?:string}>=[];
  for(const id of ids){
    const {data,error}=await db.rpc("publish_document_module_proposal_atomic",{
      p_workspace_id:workspace.id,p_project_id:project.id,p_proposal_id:id,
      p_action:"approve",p_actor_id:user.id,
      p_note:"Zbiorcza świadoma decyzja użytkownika — sesja "+body.sessionId
    }).single<{result_status:string}>();
    results.push({id,status:error?"error":data?.result_status??"error",
      ...(error?{error:error.message.slice(0,240)}:{})});
  }
  const succeeded=results.filter(r=>r.status==="published").length;
  if(succeeded){
    await db.from("audit_events").insert({
      workspace_id:workspace.id,project_id:project.id,actor_id:user.id,actor_type:"user",
      event_type:"document.import_group_approved",entity_type:"document_import_session",
      entity_id:body.sessionId,
      after_value:{module:body.module,proposalType:body.proposalType,submitted:ids.length,succeeded}
    });
    try{await runInvestmentAutopilot({workspaceId:workspace.id,projectId:project.id,userId:user.id});}
    catch{console.warn("[import-group-approval] Investment autopilot refresh deferred");}
  }
  return NextResponse.json({ok:succeeded===ids.length,succeeded,
    failed:ids.length-succeeded,results},
    {status:succeeded?200:422,headers:{"Cache-Control":"no-store"}});
}
