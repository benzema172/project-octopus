import "server-only";

import { cache } from "react";
import { listAiInbox, type ProjectExecutionSnapshot } from "@/lib/data/operations";
import { buildInvestmentAutopilotSnapshot, type AutopilotDecision, type AutopilotInput, type InvestmentAutopilotSnapshot } from "@/lib/investments/autopilot";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Json = Record<string, unknown>;

function record(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function array<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }

export const getControlSnapshotRaw = cache(async (workspaceId: string, projectId: string) => {
  const db=createServiceSupabaseClient();
  const { error: refreshError }=await db.rpc("refresh_project_anomalies",{p_workspace_id:workspaceId,p_project_id:projectId});
  if(refreshError) console.error("Project Octopus: Control anomaly refresh failed",refreshError.message);
  const {data,error}=await db.rpc("get_project_control_snapshot",{p_workspace_id:workspaceId,p_project_id:projectId});
  if(error) throw new Error(`Control Snapshot nie może odczytać stanu inwestycji: ${error.message}`);
  return record(data);
});

export async function getControlCommandCenterData(workspaceId:string,projectId:string){
  const raw=await getControlSnapshotRaw(workspaceId,projectId);
  const snapshot=record(raw.commandCenter);
  const health=record(snapshot.projectHealth);
  if(!Object.keys(health).length){
    const anomalies=record(snapshot.anomalies),schedule=record(snapshot.schedule),quality=record(snapshot.quality),forecast=record(snapshot.forecast);
    const critical=Number(anomalies.critical??0),open=Number(anomalies.open??0),overdueCritical=Number(schedule.overdueCritical??0),missingEvidence=Number(quality.missingEvidence??0),actualCost=Number(snapshot.actualCost??0),contractValue=Number(snapshot.contractValue??0),margin=forecast.margin==null?null:Number(forecast.margin);
    let score=100-critical*18-Math.max(0,open-critical)*4-overdueCritical*10-Math.min(20,missingEvidence*2);if(margin!=null&&margin<0)score-=20;if(contractValue>0&&actualCost>contractValue)score-=15;score=Math.max(0,Math.min(100,Math.round(score)));
    const status=score>=85?"healthy":score>=65?"watch":score>=40?"risk":"critical";
    const nextAction=critical>0?"Rozwiąż krytyczne anomalie przed kolejnymi zatwierdzeniami.":overdueCritical>0?"Zaktualizuj opóźnione zadania krytyczne i prognozę terminu.":margin!=null&&margin<0?"Przejrzyj koszty, zobowiązania i zmiany kontraktowe — forecast pokazuje stratę.":missingEvidence>0?"Uzupełnij brakujące dowody odbiorowe i protokoły.":open>0?"Przejrzyj otwarte odchylenia w Anomaly Engine.":"Brak krytycznej blokady — kontynuuj realizację zgodnie z harmonogramem.";
    snapshot.projectHealth={score,status,nextAction,critical,open,overdueCritical,missingEvidence};snapshot.nextAction=nextAction;
  }
  return {snapshot,anomalies:array(raw.anomalies),correspondence:array(raw.correspondence),resources:array(raw.resources),employees:array(raw.employees)};
}

export async function getControlAutopilotSnapshot(workspaceId:string,projectId:string,options:{includeFinance?:boolean;includeWarehouse?:boolean}={}):Promise<InvestmentAutopilotSnapshot>{
  const [raw,aiInbox]=await Promise.all([getControlSnapshotRaw(workspaceId,projectId),listAiInbox(workspaceId).catch(()=>[])]);
  const decisions:AutopilotDecision[]=aiInbox.filter(item=>item.projectId===projectId).map(item=>({id:item.id,title:item.title,subtitle:item.subtitle,status:item.status,confidence:item.confidence,category:item.category,detail:item.detail}));
  const input:AutopilotInput={
    nowIso:new Date().toISOString(),projectId,workspaceId,
    documents:array<AutopilotInput["documents"][number]>(raw.documents),
    facts:array<AutopilotInput["facts"][number]>(raw.facts),
    requirements:array<AutopilotInput["requirements"][number]>(raw.requirements),
    protocolRequirements:array<AutopilotInput["protocolRequirements"][number]>(raw.protocolRequirements),
    protocols:array<AutopilotInput["protocols"][number]>(raw.protocols),
    materialRequests:array<AutopilotInput["materialRequests"][number]>(raw.materialRequests),
    scheduleActivities:array<AutopilotInput["scheduleActivities"][number]>(raw.scheduleActivities),
    impacts:array<AutopilotInput["impacts"][number]>(raw.impacts),
    evidence:array<AutopilotInput["evidence"][number]>(raw.evidence),
    findings:array<AutopilotInput["findings"][number]>(raw.findings),
    materials:array<AutopilotInput["materials"][number]>(raw.materials),
    devices:array<AutopilotInput["devices"][number]>(raw.devices),
    wbsNodes:array<AutopilotInput["wbsNodes"][number]>(raw.wbsNodes),
    boqItems:array<AutopilotInput["boqItems"][number]>(raw.boqItems),
    boqVersions:array<AutopilotInput["boqVersions"][number]>(raw.boqVersions),
    aiDecisions:decisions,
    finance:options.includeFinance?{
      allocations:array<NonNullable<AutopilotInput["finance"]>["allocations"][number]>(raw.allocations),
      invoices:array<NonNullable<AutopilotInput["finance"]>["invoices"][number]>(raw.invoices),
      invoiceLines:array<NonNullable<AutopilotInput["finance"]>["invoiceLines"][number]>(raw.invoiceLines)
    }:null,
    warehouse:options.includeWarehouse?{
      movements:array<NonNullable<AutopilotInput["warehouse"]>["movements"][number]>(raw.movements),
      movementLines:array<NonNullable<AutopilotInput["warehouse"]>["movementLines"][number]>(raw.movementLines),
      stockItems:array<NonNullable<AutopilotInput["warehouse"]>["stockItems"][number]>(raw.stockItems)
    }:null
  };
  return buildInvestmentAutopilotSnapshot(input);
}

export async function getControlReconciliationData(workspaceId:string,projectId:string){
  const raw=await getControlSnapshotRaw(workspaceId,projectId);
  return {graph:record(raw.costGraph),links:array(raw.entityLinks),orders:array(raw.purchaseOrders),requests:array(raw.materialRequests),counterparties:array(raw.counterparties),stockItems:array(raw.stockItems),boqItems:array(raw.boqItems)};
}

export async function getControlExecutionSnapshot(workspaceId:string,projectId:string):Promise<ProjectExecutionSnapshot>{
  const raw=await getControlSnapshotRaw(workspaceId,projectId);const e=record(raw.execution);const forecast=record(e.latestForecast);
  return {schemaReady:true,boqItems:Number(e.boqItems??0),wbsNodes:Number(e.wbsNodes??0),requirements:Number(e.requirements??0),protocolsRequired:Number(e.protocolsRequired??0),protocolsClosed:Number(e.protocolsClosed??0),scheduleActivities:Number(e.scheduleActivities??0),progressEntries:Number(e.progressEntries??0),evidenceRequired:Number(e.evidenceRequired??0),evidenceComplete:Number(e.evidenceComplete??0),changeImpacts:Number(e.changeImpacts??0),materialEvents:Number(e.materialEvents??0),siteEvents:Number(e.siteEvents??0),closeoutRequired:Number(e.closeoutRequired??0),closeoutComplete:Number(e.closeoutComplete??0),latestForecast:Object.keys(forecast).length?{forecast_finish_date:forecast.forecast_finish_date?String(forecast.forecast_finish_date):null,estimate_at_completion:Number(forecast.estimate_at_completion??0),forecast_margin:forecast.forecast_margin==null?null:Number(forecast.forecast_margin)}:null};
}
