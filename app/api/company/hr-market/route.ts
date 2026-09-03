import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { workspaceId?: string; action?: string; payload?: Record<string, unknown> };
type Level = "write" | "approve";
const APPROVE = new Set(["requisition_approve","candidate_status","trip_status","performance_review_update","compensation_event_create","bonus_create","succession_create","employee_request_status","recommendation_status","rcp_disable"]);
const s = (v: unknown) => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
const n = (v: unknown) => { if (v === undefined || v === null || v === "") return null; const x = Number(String(v).replace(/\s/g, "").replace(",", ".")); if (!Number.isFinite(x)) throw new Error("Nieprawidłowa wartość liczbowa."); return x; };
const d = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : null;
const ts = (v: unknown) => { if (!s(v)) return null; const x = new Date(s(v)); return Number.isNaN(x.getTime()) ? null : x.toISOString(); };
const csv = (v: unknown) => s(v).split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0,100);
const bool = (v: unknown) => v === true || ["1","true","yes","tak","on"].includes(s(v).toLowerCase());
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

async function owned(table: string, value: unknown, workspaceId: string, label: string, optional = false): Promise<string | null> {
  const id = s(value); if (!id && optional) return null; if (!id) throw new Error(`Wybierz: ${label}.`);
  const { data, error } = await createServiceSupabaseClient().from(table).select("id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`); return id;
}
async function audit(workspaceId: string, userId: string, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
  await createServiceSupabaseClient().from("audit_events").insert({ workspace_id: workspaceId, actor_id: userId, event_type: `hr400.${action}`, entity_type: entityType, entity_id: entityId, after_value: payload });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request); if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body; try { body = await readJsonBody<Body>(request); } catch (error) { if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  if (!body.workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId); if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const level: Level = APPROVE.has(body.action) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level })) return NextResponse.json({ error: level === "approve" ? "Brak uprawnienia do zatwierdzania decyzji kadrowych." : "Brak uprawnienia do zapisu w Kadrach." }, { status: 403 });
  const db = createServiceSupabaseClient(); const p = body.payload;
  try {
    let id = ""; let result: unknown; let issuedSecret: string | undefined;
    if (body.action === "requisition_create") {
      const projectId = await owned("projects", p.projectId, workspace.id, "Inwestycja", true);
      const { data, error } = await db.from("hr_job_requisitions").insert({ workspace_id: workspace.id, project_id: projectId, title: s(p.title), position: s(p.position), department: s(p.department)||null, headcount: n(p.headcount)??1, employment_type:s(p.employmentType)||null, location:s(p.location)||null, required_qualifications:csv(p.requiredQualifications), min_compensation:n(p.minCompensation), max_compensation:n(p.maxCompensation), target_start:d(p.targetStart), description:s(p.description)||null, status:"draft", created_by:user.id }).select("id").single<{id:string}>(); if(error)throw error; id=data.id;
    } else if (body.action === "requisition_approve") {
      id=(await owned("hr_job_requisitions",p.requisitionId,workspace.id,"Rekrutacja"))!; const {error}=await db.from("hr_job_requisitions").update({status:"open",approved_by:user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "candidate_create") {
      const requisitionId=await owned("hr_job_requisitions",p.requisitionId,workspace.id,"Rekrutacja",true); const {data,error}=await db.from("hr_candidates").insert({workspace_id:workspace.id,requisition_id:requisitionId,first_name:s(p.firstName),last_name:s(p.lastName),email:s(p.email)||null,phone:s(p.phone)||null,source:s(p.source)||null,consent_until:d(p.consentUntil),notes:s(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "candidate_status") {
      id=(await owned("hr_candidates",p.candidateId,workspace.id,"Kandydat"))!; const status=s(p.status); if(!["new","screening","interview","offer","hired","rejected","withdrawn","archived"].includes(status))throw new Error("Nieprawidłowy status kandydata."); const {error}=await db.from("hr_candidates").update({status,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "candidate_event") {
      const candidateId=(await owned("hr_candidates",p.candidateId,workspace.id,"Kandydat"))!; const interviewer=await owned("employees",p.interviewerEmployeeId,workspace.id,"Prowadzący",true); const {data,error}=await db.from("hr_candidate_events").insert({workspace_id:workspace.id,candidate_id:candidateId,event_type:s(p.eventType)||"note",event_at:ts(p.eventAt)??new Date().toISOString(),interviewer_employee_id:interviewer,outcome:s(p.outcome)||null,notes:s(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "lifecycle_task_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const responsible=await owned("employees",p.responsibleEmployeeId,workspace.id,"Odpowiedzialny",true); const lifecycle=s(p.lifecycle)||"onboarding"; if(!["onboarding","offboarding"].includes(lifecycle))throw new Error("Nieprawidłowy proces lifecycle."); const {data,error}=await db.from("hr_lifecycle_tasks").insert({workspace_id:workspace.id,employee_id:employeeId,lifecycle,task_type:s(p.taskType)||"other",title:s(p.title),description:s(p.description)||null,due_date:d(p.dueDate),responsible_employee_id:responsible,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "lifecycle_task_status") {
      id=(await owned("hr_lifecycle_tasks",p.taskId,workspace.id,"Zadanie"))!; const status=s(p.status); const {error}=await db.from("hr_lifecycle_tasks").update({status,completed_at:status==="done"?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "trip_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const projectId=await owned("projects",p.projectId,workspace.id,"Inwestycja",true); const vehicleId=await owned("vehicles",p.vehicleId,workspace.id,"Pojazd",true); const from=d(p.dateFrom),to=d(p.dateTo);if(!from||!to)throw new Error("Podaj zakres delegacji."); const {data,error}=await db.from("hr_business_trips").insert({workspace_id:workspace.id,employee_id:employeeId,project_id:projectId,destination:s(p.destination),purpose:s(p.purpose),date_from:from,date_to:to,transport_mode:s(p.transportMode)||null,vehicle_id:vehicleId,distance_km:n(p.distanceKm),mileage_rate:n(p.mileageRate),per_diem:n(p.perDiem)??0,advance_amount:n(p.advanceAmount)??0,notes:s(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "trip_status") {
      id=(await owned("hr_business_trips",p.tripId,workspace.id,"Delegacja"))!; const status=s(p.status); const patch:Record<string,unknown>={status,updated_at:new Date().toISOString()}; if(status==="approved"){patch.approved_by=user.id;patch.approved_at=new Date().toISOString();} const {error}=await db.from("hr_business_trips").update(patch).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "trip_expense") {
      const tripId=(await owned("hr_business_trips",p.tripId,workspace.id,"Delegacja"))!; const amount=n(p.amount);if(amount===null||amount<0)throw new Error("Podaj koszt."); const {data,error}=await db.from("hr_business_trip_expenses").insert({workspace_id:workspace.id,trip_id:tripId,expense_type:s(p.expenseType),expense_date:d(p.expenseDate)??new Date().toISOString().slice(0,10),amount,currency:s(p.currency)||"PLN",description:s(p.description)||null}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "competency_create") {
      const {data,error}=await db.from("hr_competency_catalog").insert({workspace_id:workspace.id,code:s(p.code).toUpperCase(),name:s(p.name),category:s(p.category)||null,description:s(p.description)||null,level_scale:n(p.levelScale)??5}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "competency_assign") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const competencyId=(await owned("hr_competency_catalog",p.competencyId,workspace.id,"Kompetencja"))!; const {data,error}=await db.from("hr_employee_competencies").upsert({workspace_id:workspace.id,employee_id:employeeId,competency_id:competencyId,level:n(p.level)??1,verified:bool(p.verified),verified_at:bool(p.verified)?new Date().toISOString().slice(0,10):null,valid_until:d(p.validUntil),notes:s(p.notes)||null,updated_at:new Date().toISOString()},{onConflict:"employee_id,competency_id"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "training_create") {
      const employeeId=await owned("employees",p.employeeId,workspace.id,"Pracownik",true); const competencyId=await owned("hr_competency_catalog",p.competencyId,workspace.id,"Kompetencja",true); const {data,error}=await db.from("hr_training_plans").insert({workspace_id:workspace.id,employee_id:employeeId,competency_id:competencyId,title:s(p.title),provider:s(p.provider)||null,planned_date:d(p.plannedDate),due_date:d(p.dueDate),cost:n(p.cost),currency:s(p.currency)||"PLN",notes:s(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "training_status") {
      id=(await owned("hr_training_plans",p.trainingId,workspace.id,"Szkolenie"))!; const status=s(p.status); const {error}=await db.from("hr_training_plans").update({status,completed_at:status==="completed"?(d(p.completedAt)??new Date().toISOString().slice(0,10)):null,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "performance_cycle_create") {
      const {data,error}=await db.from("hr_performance_cycles").insert({workspace_id:workspace.id,name:s(p.name),date_from:d(p.dateFrom),date_to:d(p.dateTo),methodology:s(p.methodology)||"goals",status:"draft",created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "goal_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const cycleId=await owned("hr_performance_cycles",p.cycleId,workspace.id,"Cykl",true); const {data,error}=await db.from("hr_goals").insert({workspace_id:workspace.id,cycle_id:cycleId,employee_id:employeeId,title:s(p.title),description:s(p.description)||null,target_value:n(p.targetValue),current_value:n(p.currentValue),unit:s(p.unit)||null,weight:n(p.weight)??1,due_date:d(p.dueDate),status:"active"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "performance_review_update") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const cycleId=(await owned("hr_performance_cycles",p.cycleId,workspace.id,"Cykl"))!; const reviewer=await owned("employees",p.reviewerEmployeeId,workspace.id,"Recenzent",true); const {data,error}=await db.from("hr_performance_reviews").upsert({workspace_id:workspace.id,cycle_id:cycleId,employee_id:employeeId,reviewer_employee_id:reviewer,status:s(p.status)||"manager_review",manager_summary:s(p.managerSummary)||null,rating:n(p.rating),updated_at:new Date().toISOString()},{onConflict:"cycle_id,employee_id"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "demand_create") {
      const projectId=(await owned("projects",p.projectId,workspace.id,"Inwestycja"))!; const {data,error}=await db.from("hr_workforce_demands").insert({workspace_id:workspace.id,project_id:projectId,date_from:d(p.dateFrom),date_to:d(p.dateTo),role:s(p.role),required_count:n(p.requiredCount)??1,required_qualifications:csv(p.requiredQualifications),required_competencies:[],shift:s(p.shift)||null,notes:s(p.notes)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
      const rpc=await db.rpc("build_hr_crew_400",{p_workspace_id:workspace.id,p_demand_id:id});if(rpc.error)throw rpc.error;result={suggestions:rpc.data};
    } else if (body.action === "crew_build") {
      id=(await owned("hr_workforce_demands",p.demandId,workspace.id,"Zapotrzebowanie"))!; const rpc=await db.rpc("build_hr_crew_400",{p_workspace_id:workspace.id,p_demand_id:id});if(rpc.error)throw rpc.error;result={suggestions:rpc.data};
    } else if (body.action === "compensation_event_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const {data,error}=await db.from("hr_compensation_events").insert({workspace_id:workspace.id,employee_id:employeeId,event_type:s(p.eventType)||"review",effective_from:d(p.effectiveFrom)??new Date().toISOString().slice(0,10),old_gross:n(p.oldGross),new_gross:n(p.newGross),old_employer_cost:n(p.oldEmployerCost),new_employer_cost:n(p.newEmployerCost),currency:s(p.currency)||"PLN",reason:s(p.reason)||null,approved_by:user.id,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "bonus_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const projectId=await owned("projects",p.projectId,workspace.id,"Inwestycja",true); const {data,error}=await db.from("hr_bonuses").insert({workspace_id:workspace.id,employee_id:employeeId,project_id:projectId,period_month:d(p.periodMonth),bonus_type:s(p.bonusType),amount:n(p.amount)??0,currency:s(p.currency)||"PLN",reason:s(p.reason)||null,status:"approved",approved_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "survey_create") {
      const {data,error}=await db.from("hr_surveys").insert({workspace_id:workspace.id,title:s(p.title),description:s(p.description)||null,anonymous:bool(p.anonymous),date_from:d(p.dateFrom),date_to:d(p.dateTo),status:"draft",questions:csv(p.questions).map((q,index)=>({id:index+1,text:q,type:"scale_1_5"})),created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "career_path_create") {
      const {data,error}=await db.from("hr_career_paths").insert({workspace_id:workspace.id,name:s(p.name),current_role:s(p.currentRole)||null,target_role:s(p.targetRole)||null,required_competencies:[]}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "succession_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const pathId=await owned("hr_career_paths",p.careerPathId,workspace.id,"Ścieżka kariery",true); const {data,error}=await db.from("hr_succession_candidates").insert({workspace_id:workspace.id,career_path_id:pathId,employee_id:employeeId,readiness:s(p.readiness)||"future",development_plan:s(p.developmentPlan)||null,created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "employee_request_create") {
      const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const {data,error}=await db.from("hr_employee_requests").insert({workspace_id:workspace.id,employee_id:employeeId,request_type:s(p.requestType),title:s(p.title),payload:{details:s(p.details)},status:"submitted"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "employee_request_status") {
      id=(await owned("hr_employee_requests",p.requestId,workspace.id,"Wniosek"))!; const {error}=await db.from("hr_employee_requests").update({status:s(p.status),reviewed_by:user.id,reviewed_at:new Date().toISOString(),notes:s(p.notes)||null,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "rcp_connection_create") {
      issuedSecret=randomBytes(32).toString("base64url"); const {data,error}=await db.from("hr_rcp_connections").insert({workspace_id:workspace.id,provider:s(p.provider)||"generic",name:s(p.name)||"RCP",mode:s(p.mode)||"webhook",capabilities:csv(p.capabilities),config:{notes:s(p.notes)},created_by:user.id}).select("id").single<{id:string}>();if(error)throw error;id=data.id; const rpc=await db.rpc("set_hr_rcp_secret_hash_400",{p_workspace_id:workspace.id,p_connection_id:id,p_secret_hash:hash(issuedSecret)});if(rpc.error)throw rpc.error;
    } else if (body.action === "rcp_map") {
      const connectionId=(await owned("hr_rcp_connections",p.connectionId,workspace.id,"Integracja RCP"))!; const employeeId=(await owned("employees",p.employeeId,workspace.id,"Pracownik"))!; const external=s(p.externalEmployeeId);if(!external)throw new Error("Podaj identyfikator pracownika w RCP."); const {data,error}=await db.from("hr_rcp_employee_mappings").upsert({workspace_id:workspace.id,connection_id:connectionId,employee_id:employeeId,external_employee_id:external,active:true},{onConflict:"connection_id,external_employee_id"}).select("id").single<{id:string}>();if(error)throw error;id=data.id;
    } else if (body.action === "rcp_disable") {
      id=(await owned("hr_rcp_connections",p.connectionId,workspace.id,"Integracja RCP"))!; const {error}=await db.from("hr_rcp_connections").update({status:"disabled",updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else if (body.action === "refresh_intelligence") {
      const rpc=await db.rpc("hr_daily_controller_400",{p_workspace_id:workspace.id,p_reference_date:d(p.referenceDate)??new Date().toISOString().slice(0,10)});if(rpc.error)throw rpc.error;id=workspace.id;result=rpc.data;
    } else if (body.action === "recommendation_status") {
      id=(await owned("hr_ai_recommendations",p.recommendationId,workspace.id,"Rekomendacja"))!; const status=s(p.status);if(!["accepted","dismissed","executed"].includes(status))throw new Error("Nieprawidłowy status rekomendacji."); const {error}=await db.from("hr_ai_recommendations").update({status,resolved_by:user.id,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);if(error)throw error;
    } else return NextResponse.json({ error: "Nieobsługiwana operacja Kadr 4.0." }, { status: 400 });
    if (!id) throw new Error("Operacja nie zwróciła identyfikatora."); await audit(workspace.id,user.id,body.action,"hr400",id,p); return NextResponse.json({ok:true,id,result,issuedSecret});
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja Kadr 4.0 nie powiodła się." }, { status: 422 }); }
}
