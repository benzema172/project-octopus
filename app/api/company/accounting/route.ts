import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { runAccountingCopilotForInvoice } from "@/lib/ai/accounting-copilot";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Action = "entry_regenerate" | "entry_approve" | "entry_reject" | "line_update" | "suggestion_apply" | "rule_save" | "rule_toggle" | "settings_update" | "profile_save" | "profile_default";
type Body = { workspaceId?: string; action?: Action; payload?: Record<string,unknown> };
const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f;};

export async function POST(request:Request) {
  const user=await getRequestUser(request);
  if(!user) return NextResponse.json({error:"Brak aktywnej sesji."},{status:401});
  let body:Body;
  try{body=await request.json() as Body;}catch{return NextResponse.json({error:"Nieprawidłowe dane operacji."},{status:400});}
  if(!body.workspaceId||!body.action) return NextResponse.json({error:"Brakuje firmy lub operacji."},{status:400});
  const workspace=await getWorkspaceForUser(user,body.workspaceId);
  if(!workspace) return NextResponse.json({error:"Brak dostępu do firmy."},{status:403});
  const payload=body.payload??{}, db=createServiceSupabaseClient();
  const requireLevel=async(level:"write"|"approve")=>{
    if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"finance",level})) throw new Error(level==="approve"?"Brak uprawnienia do zatwierdzania księgowości.":"Brak uprawnienia do zmiany księgowości.");
  };

  try{
    if(body.action==="entry_regenerate"){
      await requireLevel("write");
      const invoiceId=text(payload.invoiceId); if(!invoiceId) throw new Error("Brak faktury do ponownej dekretacji.");
      return NextResponse.json({ok:true,result:await runAccountingCopilotForInvoice(workspace.id,invoiceId,user.id)});
    }
    if(body.action==="entry_approve"){
      await requireLevel("approve");
      const entryId=text(payload.entryId); if(!entryId) throw new Error("Brak dekretu.");
      const {data,error}=await db.rpc("approve_accounting_entry_700",{p_workspace_id:workspace.id,p_entry_id:entryId,p_actor_id:user.id});
      if(error) throw new Error(error.message);
      return NextResponse.json({ok:true,result:data});
    }
    if(body.action==="entry_reject"){
      await requireLevel("approve");
      const entryId=text(payload.entryId); if(!entryId) throw new Error("Brak dekretu.");
      const current=await db.from("accounting_entries").select("id,project_id,exported_at").eq("workspace_id",workspace.id).eq("id",entryId).maybeSingle();
      if(current.error||!current.data) throw new Error(current.error?.message??"Nie znaleziono dekretu.");
      if(current.data.exported_at) throw new Error("Wyeksportowanego dekretu nie można odrzucić.");
      await db.from("accounting_entries").update({status:"rejected",needs_review:true,approved_by:null,approved_at:null,locked_at:null,updated_at:new Date().toISOString()}).eq("id",entryId).eq("workspace_id",workspace.id);
      await db.from("audit_events").insert({workspace_id:workspace.id,project_id:current.data.project_id,actor_id:user.id,actor_type:"user",event_type:"accounting.entry_rejected_700",entity_type:"accounting_entry",entity_id:entryId,after_value:{reason:text(payload.reason)||null}});
      return NextResponse.json({ok:true});
    }
    if(body.action==="line_update"){
      await requireLevel("approve");
      const lineId=text(payload.lineId), accountId=text(payload.accountId), tax=text(payload.taxTreatment)||"review";
      if(!lineId||!accountId) throw new Error("Wybierz linię i konto.");
      if(!["KUP","NKUP","neutral","review"].includes(tax)) throw new Error("Nieprawidłowa klasyfikacja podatkowa.");
      const line=await db.from("accounting_entry_lines").select("id,entry_id").eq("workspace_id",workspace.id).eq("id",lineId).maybeSingle<{id:string;entry_id:string}>();
      if(line.error||!line.data) throw new Error(line.error?.message??"Nie znaleziono linii dekretu.");
      const entry=await db.from("accounting_entries").select("status,exported_at").eq("workspace_id",workspace.id).eq("id",line.data.entry_id).maybeSingle<{status:string;exported_at:string|null}>();
      if(entry.error||!entry.data) throw new Error(entry.error?.message??"Nie znaleziono dekretu.");
      if(entry.data.status==="approved"||entry.data.exported_at) throw new Error("Zatwierdzonego lub wyeksportowanego dekretu nie można edytować.");
      const account=await db.from("accounting_accounts").select("id").eq("workspace_id",workspace.id).eq("id",accountId).eq("active",true).maybeSingle();
      if(account.error||!account.data) throw new Error("Konto nie należy do aktywnego planu kont.");
      const vat=payload.vatDeductionPct==null||text(payload.vatDeductionPct)===""?null:Math.max(0,Math.min(100,num(payload.vatDeductionPct)));
      const update=await db.from("accounting_entry_lines").update({
        account_id:accountId,tax_treatment:tax,vat_deduction_pct:vat,vat_code:text(payload.vatCode)||null,cost_code:text(payload.costCode)||null,
        manual_override:true,source_rule_id:null,ai_confidence:1,ai_reason:"Korekta użytkownika / księgowej.",ai_evidence:{source:"human_override",actorId:user.id},updated_at:new Date().toISOString()
      }).eq("workspace_id",workspace.id).eq("id",lineId);
      if(update.error) throw new Error(update.error.message);
      const unresolved=await db.from("accounting_entry_lines").select("id").eq("workspace_id",workspace.id).eq("entry_id",line.data.entry_id).eq("tax_treatment","review").limit(1);
      await db.from("accounting_entries").update({needs_review:Boolean(unresolved.data?.length),updated_at:new Date().toISOString()}).eq("id",line.data.entry_id).eq("workspace_id",workspace.id);
      return NextResponse.json({ok:true});
    }
    if(body.action==="suggestion_apply"){
      await requireLevel("approve");
      const suggestionId=text(payload.suggestionId); if(!suggestionId) throw new Error("Brak sugestii AI.");
      const suggestion=await db.from("accounting_ai_suggestions").select("id,line_id,suggested_account_id,suggested_tax_treatment,suggested_vat_deduction_pct,summary,reasons,status").eq("workspace_id",workspace.id).eq("id",suggestionId).maybeSingle();
      if(suggestion.error||!suggestion.data||!suggestion.data.line_id||!suggestion.data.suggested_account_id) throw new Error("Sugestia AI jest niekompletna.");
      const update=await db.from("accounting_entry_lines").update({
        account_id:suggestion.data.suggested_account_id,tax_treatment:suggestion.data.suggested_tax_treatment??"review",vat_deduction_pct:suggestion.data.suggested_vat_deduction_pct,
        manual_override:true,source_rule_id:null,ai_confidence:1,ai_reason:"Sugestia AI zatwierdzona przez użytkownika: "+text(suggestion.data.summary),
        ai_evidence:{source:"ai_suggestion_human_approved",suggestionId,reasons:suggestion.data.reasons??[]},updated_at:new Date().toISOString()
      }).eq("workspace_id",workspace.id).eq("id",suggestion.data.line_id);
      if(update.error) throw new Error(update.error.message);
      await db.from("accounting_ai_suggestions").update({status:"applied",updated_at:new Date().toISOString()}).eq("id",suggestionId);
      return NextResponse.json({ok:true});
    }
    if(body.action==="rule_save"){
      await requireLevel("approve");
      const id=text(payload.id), name=text(payload.name); if(!name) throw new Error("Podaj nazwę schematu.");
      const record={
        workspace_id:workspace.id,name,priority:Math.round(num(payload.priority,700)),active:payload.active!==false,direction:text(payload.direction)||"purchase",
        line_type:text(payload.lineType)||null,expense_category:text(payload.expenseCategory)||null,allocation_scope:text(payload.allocationScope)||null,
        counterparty_id:text(payload.counterpartyId)||null,debit_account_code:text(payload.debitAccountCode)||null,credit_account_code:text(payload.creditAccountCode)||null,
        default_cost_code:text(payload.defaultCostCode)||null,tax_treatment:text(payload.taxTreatment)||null,vat_code:text(payload.vatCode)||null,
        vat_deduction_pct:payload.vatDeductionPct==null||text(payload.vatDeductionPct)===""?null:Math.max(0,Math.min(100,num(payload.vatDeductionPct))),
        min_confidence:Math.max(0,Math.min(1,num(payload.minConfidence,0.98))),accountant_rule:true,notes:text(payload.notes)||null,updated_at:new Date().toISOString()
      };
      const result=id?await db.from("accounting_rules").update(record).eq("workspace_id",workspace.id).eq("id",id):await db.from("accounting_rules").insert(record);
      if(result.error) throw new Error(result.error.message);
      return NextResponse.json({ok:true});
    }
    if(body.action==="rule_toggle"){
      await requireLevel("approve");
      const id=text(payload.id); if(!id) throw new Error("Brak schematu.");
      const result=await db.from("accounting_rules").update({active:payload.active===true,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",id);
      if(result.error) throw new Error(result.error.message);
      return NextResponse.json({ok:true});
    }
    if(body.action==="settings_update"){
      await requireLevel("approve");
      const record={
        proposal_confidence_threshold:Math.max(0.5,Math.min(1,num(payload.proposalConfidenceThreshold,0.92))),
        ai_auto_apply_threshold:Math.max(0.8,Math.min(1,num(payload.aiAutoApplyThreshold,0.97))),
        allow_ai_auto_approval:false,
        require_jpk_markers:payload.requireJpkMarkers===true,
        default_vat_deduction_pct:Math.max(0,Math.min(100,num(payload.defaultVatDeductionPct,100))),
        fiscal_year_start_month:Math.max(1,Math.min(12,Math.round(num(payload.fiscalYearStartMonth,1)))),
        updated_by:user.id,updated_at:new Date().toISOString()
      };
      const result=await db.from("accounting_settings").upsert({workspace_id:workspace.id,...record},{onConflict:"workspace_id"});
      if(result.error) throw new Error(result.error.message);
      return NextResponse.json({ok:true});
    }
    if(body.action==="profile_save"){
      await requireLevel("approve");
      const id=text(payload.id), name=text(payload.name), adapter=text(payload.adapter)||"generic_csv";
      if(!name||!["generic_csv","octopus_json","custom_csv"].includes(adapter)) throw new Error("Nieprawidłowy profil eksportu.");
      const record={workspace_id:workspace.id,name,adapter,delimiter:text(payload.delimiter)||";",mapping:payload.mapping&&typeof payload.mapping==="object"?payload.mapping:{},active:true,updated_at:new Date().toISOString()};
      const result=id?await db.from("accounting_export_profiles").update(record).eq("workspace_id",workspace.id).eq("id",id):await db.from("accounting_export_profiles").insert({...record,created_by:user.id});
      if(result.error) throw new Error(result.error.message);
      return NextResponse.json({ok:true});
    }
    await requireLevel("approve");
    const profileId=text(payload.profileId); if(!profileId) throw new Error("Brak profilu eksportu.");
    await db.from("accounting_export_profiles").update({is_default:false,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id);
    const result=await db.from("accounting_export_profiles").update({is_default:true,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id).eq("id",profileId);
    if(result.error) throw new Error(result.error.message);
    return NextResponse.json({ok:true});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Operacja księgowa nie powiodła się."},{status:422});
  }
}
