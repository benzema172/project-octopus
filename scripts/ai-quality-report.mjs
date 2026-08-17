import { createClient } from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
const workspaceId=process.env.AI_QUALITY_WORKSPACE_ID;
const days=Math.max(1,Math.min(365,Number(process.env.AI_QUALITY_DAYS)||30));
if(!url||!secret||!workspaceId){console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and AI_QUALITY_WORKSPACE_ID.");process.exit(1);}
const client=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
const {data,error}=await client.rpc("get_ai_quality_metrics",{p_workspace_id:workspaceId,p_days:days});
if(error){console.error(error.message);process.exit(1);}
const metrics=data??{};
const report={
 generatedAt:new Date().toISOString(),workspaceId,days,
 analyses:Number(metrics.analyses??0),reviews:Number(metrics.reviews??0),
 averageConfidence:Number(metrics.averageConfidence??0),averageProjectMatch:Number(metrics.averageProjectMatch??0),
 correctionRate:Number(metrics.correctionRate??0),errors:Number(metrics.errors??0),warnings:Number(metrics.warnings??0),
 models:metrics.models??[],categories:metrics.categories??[]
};
console.log(JSON.stringify(report,null,2));
const minAnalyses=Number(process.env.AI_QUALITY_MIN_ANALYSES)||0;
const maxCorrectionRate=Number(process.env.AI_QUALITY_MAX_CORRECTION_RATE||1);
if(report.analyses<minAnalyses){console.error(`Quality gate failed: ${report.analyses} analyses < ${minAnalyses}.`);process.exit(2);}
if(report.reviews>0&&report.correctionRate>maxCorrectionRate){console.error(`Quality gate failed: correction rate ${report.correctionRate} > ${maxCorrectionRate}.`);process.exit(3);}
