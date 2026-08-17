import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function getAiQualityMetrics(workspaceId:string,days=30){
 const {data,error}=await createServiceSupabaseClient().rpc("get_ai_quality_metrics",{p_workspace_id:workspaceId,p_days:days});
 if(error) throw new Error(`Nie udało się obliczyć jakości AI: ${error.message}`);
 return (data??{}) as Record<string,unknown>;
}
