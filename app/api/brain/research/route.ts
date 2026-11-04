import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime="nodejs";
type ReviewBody={workspaceId?:string;observationId?:string;decision?:"approved"|"rejected"};
export async function POST(request:Request){
 const user=await getRequestUser(request);
 if(!user)return NextResponse.json({error:"Brak sesji."},{status:401});
 let body:ReviewBody;
 try{body=await request.json() as ReviewBody;}catch{return NextResponse.json({error:"Nieprawidłowe dane."},{status:400});}
 if(!body.workspaceId || !body.observationId || !["approved","rejected"].includes(body.decision??""))
  return NextResponse.json({error:"Niekompletna decyzja."},{status:400});
 const workspace=await getWorkspaceForUser(user,body.workspaceId);
 if(!workspace || !await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"reports",level:"approve"}))
  return NextResponse.json({error:"Brak uprawnień."},{status:403});
 const db=createServiceSupabaseClient();
 const {data,error}=await db.from("brain_external_observations")
  .select("id,title,summary,source_url,source_name,review_status")
  .eq("workspace_id",workspace.id).eq("id",body.observationId).maybeSingle();
 if(error || !data)return NextResponse.json({error:"Nie znaleziono źródła."},{status:404});
 if(data.review_status!=="pending")return NextResponse.json({error:"Źródło już oceniono."},{status:409});
 // Do not claim a source title is a verified technical fact. Approval creates a
 // traceable bibliographic pointer, not automatic technical instructions.
 const {data:changed,error:changeError}=await db.from("brain_external_observations")
  .update({review_status:body.decision,metadata:{reviewed_by:user.id,reviewed_at:new Date().toISOString()}})
  .eq("id",data.id).eq("workspace_id",workspace.id).eq("review_status","pending").select("id");
 if(changeError || !changed?.length)return NextResponse.json({error:"Konflikt zapisu."},{status:409});
 if(body.decision==="approved"){
  const {error:knowledgeError}=await db.from("knowledge_entries").insert({
   workspace_id:workspace.id,entry_type:"external_reference",title:data.title,
   summary:"Zweryfikowany przez użytkownika odnośnik źródłowy. Treść dokumentu wymaga osobnej oceny: "+data.source_url,
   solution:null,status:"approved",approved_by:user.id,approved_at:new Date().toISOString(),
   source_references:[{url:data.source_url,publisher:data.source_name,observation_id:data.id}],
   tags:["źródło-zewnętrzne","weryfikacja"]
  });
  if(knowledgeError){
   // Roll back the workflow decision when the knowledge pointer could not be persisted.
   await db.from("brain_external_observations").update({review_status:"pending",metadata:{}}).eq("id",data.id).eq("workspace_id",workspace.id);
   return NextResponse.json({error:"Nie udało się zapisać źródła w pamięci."},{status:500});
  }
 }
 return NextResponse.json({ok:true,status:body.decision},{headers:{"Cache-Control":"no-store"}});
}
