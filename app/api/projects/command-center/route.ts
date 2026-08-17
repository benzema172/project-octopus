import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { getProjectCommandCenter } from "@/lib/data/project-command-center";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";

export const runtime="nodejs";
type Action="correspondence_create"|"resource_plan_create"|"anomaly_acknowledge"|"anomaly_resolve";
type Body={projectId?:string;action?:Action;payload?:Record<string,unknown>};
const text=(v:unknown)=>typeof v==="string"?v.trim():"";
const date=(v:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(text(v))?text(v):null;

export async function GET(request:Request){
 const user=await getRequestUser(request); if(!user)return NextResponse.json({error:"Brak sesji."},{status:401});
 const projectId=new URL(request.url).searchParams.get("projectId")?.trim(); if(!projectId)return NextResponse.json({error:"Brakuje inwestycji."},{status:400});
 const project=await getProjectForUser(user,projectId); if(!project||!await hasDomainAccess({workspaceId:project.workspace_id,userId:user.id,domain:"investments",level:"read",projectId}))return NextResponse.json({error:"Brak dostępu."},{status:403});
 try{return NextResponse.json(await getProjectCommandCenter(project.workspace_id,project.id),{headers:{"Cache-Control":"no-store"}});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Błąd Command Center."},{status:500});}
}

export async function POST(request:Request){
 const user=await getRequestUser(request); if(!user)return NextResponse.json({error:"Brak sesji."},{status:401});
 let body:Body; try{body=await request.json() as Body;}catch{return NextResponse.json({error:"Nieprawidłowe dane."},{status:400});}
 if(!body.projectId||!body.action)return NextResponse.json({error:"Brakuje operacji."},{status:400});
 const project=await getProjectForUser(user,body.projectId); if(!project||!await hasDomainAccess({workspaceId:project.workspace_id,userId:user.id,domain:"investments",level:"write",projectId:project.id}))return NextResponse.json({error:"Brak uprawnienia do zarządzania inwestycją."},{status:403});
 const db=createServiceSupabaseClient(),p=body.payload??{};
 try{
  if(body.action==="correspondence_create"){
   if(!text(p.subject))throw new Error("Uzupełnij temat korespondencji.");
   const {data,error}=await db.from("project_correspondence").insert({workspace_id:project.workspace_id,project_id:project.id,direction:text(p.direction)||"incoming",correspondence_type:text(p.correspondenceType)||"email",subject:text(p.subject),counterparty:text(p.counterparty)||null,reference_number:text(p.referenceNumber)||null,sent_at:text(p.sentAt)||null,due_at:text(p.dueAt)||null,status:"open",notes:text(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();
   if(error||!data)throw error??new Error("Nie zapisano korespondencji."); return NextResponse.json({ok:true,id:data.id});
  }
  if(body.action==="resource_plan_create"){
   const employeeId=text(p.employeeId)||null;
   if(employeeId){const {data}=await db.from("employees").select("id").eq("workspace_id",project.workspace_id).eq("id",employeeId).maybeSingle();if(!data)throw new Error("Pracownik nie należy do firmy.");}
   const weekStart=date(p.weekStart); if(!weekStart)throw new Error("Podaj tydzień planu."); if(!text(p.role))throw new Error("Uzupełnij rolę.");
   const plannedHours=parseLocalizedNumber(p.plannedHours),allocation=parseLocalizedNumber(p.allocationPercent); if(plannedHours<0||plannedHours>168)throw new Error("Plan godzin musi mieścić się w zakresie 0–168."); if(allocation<0||allocation>100)throw new Error("Alokacja musi mieścić się w zakresie 0–100%.");
   const {data,error}=await db.from("resource_plan_entries").insert({workspace_id:project.workspace_id,project_id:project.id,employee_id:employeeId,role:text(p.role),week_start:weekStart,planned_hours:plannedHours,allocation_percent:allocation||null,status:"planned",note:text(p.note)||null,created_by:user.id}).select("id").single<{id:string}>();
   if(error||!data)throw error??new Error("Nie zapisano planu zasobów."); return NextResponse.json({ok:true,id:data.id});
  }
  const anomalyId=text(p.anomalyId); if(!anomalyId)throw new Error("Brakuje anomalii.");
  const {data:anomaly}=await db.from("project_anomalies").select("id").eq("id",anomalyId).eq("workspace_id",project.workspace_id).eq("project_id",project.id).maybeSingle(); if(!anomaly)throw new Error("Anomalia nie należy do inwestycji.");
  const resolving=body.action==="anomaly_resolve"; const {error}=await db.from("project_anomalies").update(resolving?{status:"resolved",resolved_at:new Date().toISOString()}:{status:"acknowledged",acknowledged_by:user.id,acknowledged_at:new Date().toISOString()}).eq("id",anomalyId); if(error)throw error;
  return NextResponse.json({ok:true,id:anomalyId,status:resolving?"resolved":"acknowledged"});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Operacja nie powiodła się."},{status:422});}
}
