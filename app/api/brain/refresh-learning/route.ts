import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { hasDomainAccess } from "@/lib/authorization";
import { refreshContinuousBrain } from "@/lib/ai/brain-continuous";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime="nodejs";
export const maxDuration=300;

export async function POST(request:Request){
 const user=await getRequestUser(request);
 if(!user)return NextResponse.json({error:"Brak sesji."},{status:401});
 let body:{workspaceId?:string};
 try{body=await request.json() as {workspaceId?:string};}catch{return NextResponse.json({error:"Nieprawidłowe dane."},{status:400});}
 if(!body.workspaceId)return NextResponse.json({error:"Brak firmy."},{status:400});
 const workspace=await getWorkspaceForUser(user,body.workspaceId);
 if(!workspace||!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"settings",level:"admin"}))
  return NextResponse.json({error:"Tylko administrator firmy może odświeżać Brain."},{status:403});
 const db=createServiceSupabaseClient();
 const {data:last,error:lastError}=await db.from("brain_agent_coordinations")
  .select("created_at").eq("workspace_id",workspace.id).eq("scope","manual")
  .order("created_at",{ascending:false}).limit(1).maybeSingle<{created_at:string}>();
 if(lastError)return NextResponse.json({error:"Nie można sprawdzić historii aktualizacji."},{status:500});
 if(last && Date.now()-Date.parse(last.created_at)<15*60_000)
  return NextResponse.json({error:"Ponowny skan można uruchomić po 15 minutach."},{status:429});
 try{
  const result=await refreshContinuousBrain({workspaceId:workspace.id,referenceDate:new Date().toISOString().slice(0,10)});
  await db.from("brain_agent_coordinations").upsert({
   workspace_id:workspace.id,reference_date:new Date().toISOString().slice(0,10),scope:"manual",
   providers:result.council.configuredProviders,indexing:result.documents,
   feedback_count:result.feedback.total,warnings:result.research.failures
  },{onConflict:"workspace_id,reference_date,scope"});
  return NextResponse.json({ok:true,result},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("Octopus Brain manual refresh failed",error);
  return NextResponse.json({error:"Aktualizacja Brain nie powiodła się. Sprawdź logi serwera."},{status:500});
 }
}
