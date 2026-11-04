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
 const {data,error}=await db.rpc("review_brain_external_source_20261104",{
  p_workspace_id:workspace.id,p_observation_id:body.observationId,
  p_actor_id:user.id,p_decision:body.decision
 });
 if(error)return NextResponse.json({error:"Nie udało się zatwierdzić źródła."},{status:500});
 if(data!==true)return NextResponse.json({error:"Źródło zostało już ocenione lub nie istnieje."},{status:409});
 return NextResponse.json({ok:true,status:body.decision},{headers:{"Cache-Control":"no-store"}});
}
