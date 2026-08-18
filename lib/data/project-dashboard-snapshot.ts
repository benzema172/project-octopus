import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Json=Record<string,unknown>;
function record(value:unknown):Json{return value&&typeof value==="object"&&!Array.isArray(value)?value as Json:{};}
function array<T>(value:unknown):T[]{return Array.isArray(value)?value as T[]:[];}
function number(value:unknown){const n=Number(value??0);return Number.isFinite(n)?n:0;}

export type ProjectDashboardSnapshot={
  documentsCount:number;
  boqValue:number;
  acceptedWorkValue:number;
  closeoutRequired:number;
  closeoutComplete:number;
  alerts:Array<{id:string;severity:string;title:string;description:string|null}>;
  milestones:Array<{id:string;title:string;planned_start:string|null;planned_finish:string|null;actual_finish:string|null;status:string}>;
  risks:Array<{id:string;summary:string;risk_level:string}>;
  forecast:{contract_value:number|null;actual_cost:number|null;committed_cost:number|null;estimate_at_completion:number|null;forecast_margin:number|null}|null;
};

export async function getProjectDashboardSnapshot(workspaceId:string,projectId:string,includeFinance:boolean):Promise<ProjectDashboardSnapshot>{
  const {data,error}=await createServiceSupabaseClient().rpc("get_project_dashboard_snapshot",{p_workspace_id:workspaceId,p_project_id:projectId,p_include_finance:includeFinance});
  if(error)throw new Error(`Dashboard inwestycji nie może odczytać lekkiego snapshotu: ${error.message}`);
  const root=record(data),forecast=record(root.forecast);
  return{
    documentsCount:number(root.documentsCount),
    boqValue:number(root.boqValue),
    acceptedWorkValue:number(root.acceptedWorkValue),
    closeoutRequired:number(root.closeoutRequired),
    closeoutComplete:number(root.closeoutComplete),
    alerts:array(root.alerts),
    milestones:array(root.milestones),
    risks:array(root.risks),
    forecast:includeFinance&&Object.keys(forecast).length?{
      contract_value:forecast.contract_value==null?null:number(forecast.contract_value),
      actual_cost:forecast.actual_cost==null?null:number(forecast.actual_cost),
      committed_cost:forecast.committed_cost==null?null:number(forecast.committed_cost),
      estimate_at_completion:forecast.estimate_at_completion==null?null:number(forecast.estimate_at_completion),
      forecast_margin:forecast.forecast_margin==null?null:number(forecast.forecast_margin)
    }:null
  };
}
