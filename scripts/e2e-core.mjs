import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const required=["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY"];
const missing=required.filter(key=>!process.env[key]); if(missing.length){console.error(`Missing: ${missing.join(", ")}`);process.exit(1);}
const base=process.env.E2E_BASE_URL??"http://localhost:3000";
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const publicClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const id=randomUUID();
const ownerEmail=`octopus-e2e-owner-${id}@example.com`,workerEmail=`octopus-e2e-worker-${id}@example.com`,password=`Octopus-${id}-2026!`;
let ownerUser,workerUser,workspaceId;
async function createUser(email){const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error||!data.user)throw new Error(error?.message??"User creation failed");return data.user;}
async function token(email){const {data,error}=await publicClient.auth.signInWithPassword({email,password});if(error||!data.session)throw new Error(error?.message??"Sign-in failed");return data.session.access_token;}
async function api(path,accessToken,body){const response=await fetch(`${base}${path}`,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${accessToken}`,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});let payload={};try{payload=await response.json();}catch{}return {response,payload};}

try{
 ownerUser=await createUser(ownerEmail);workerUser=await createUser(workerEmail);
 const {data:workspace,error:workspaceError}=await admin.from("workspaces").insert({name:`Octopus E2E ${id}`,owner_id:ownerUser.id}).select("id").single();if(workspaceError)throw workspaceError;workspaceId=workspace.id;
 await admin.from("workspace_members").insert([{workspace_id:workspaceId,user_id:ownerUser.id,role:"owner"},{workspace_id:workspaceId,user_id:workerUser.id,role:"member"}]);
 const {data:project,error:projectError}=await admin.from("projects").insert({workspace_id:workspaceId,name:`E2E inwestycja ${id}`,status:"active",created_by:ownerUser.id}).select("id").single();if(projectError)throw projectError;
 await admin.from("project_facts").insert({project_id:project.id,fact_type:"project_profile",value_text:"E2E",value_json:{projectName:`E2E inwestycja ${id}`,status:"active",contractValue:"250000"},confidence:1,status:"approved"});
 await admin.from("domain_role_grants").insert({workspace_id:workspaceId,user_id:workerUser.id,domain:"investments",access_level:"read",project_id:project.id,granted_by:ownerUser.id});
 const ownerToken=await token(ownerEmail),workerToken=await token(workerEmail);

 // Role isolation: investment-only worker cannot create a finance budget.
 const denied=await api("/api/projects/operations",workerToken,{projectId:project.id,action:"budget_create",name:"Denied",totalRevenue:100,totalCost:50});
 if(denied.response.status!==403)throw new Error(`Role isolation failed: expected 403, got ${denied.response.status}`);

 // Concurrent budget requests must produce two distinct versions, never duplicate version numbers.
 const [budgetA,budgetB]=await Promise.all([
  api("/api/projects/operations",ownerToken,{projectId:project.id,action:"budget_create",name:"E2E A",totalRevenue:250000,totalCost:170000}),
  api("/api/projects/operations",ownerToken,{projectId:project.id,action:"budget_create",name:"E2E B",totalRevenue:250000,totalCost:175000})
 ]);
 if(!budgetA.response.ok||!budgetB.response.ok)throw new Error(`Concurrent budgets failed: ${JSON.stringify([budgetA.payload,budgetB.payload])}`);
 const versions=[budgetA.payload.versionNumber,budgetB.payload.versionNumber].sort(); if(new Set(versions).size!==2)throw new Error(`Budget versions collided: ${versions.join(",")}`);

 // Authoritative stock ledger and atomic MM.
 const warehouseA=randomUUID(),warehouseB=randomUUID(),itemId=randomUUID(),movementId=randomUUID();
 await admin.from("warehouses").insert([{id:warehouseA,workspace_id:workspaceId,name:"E2E A"},{id:warehouseB,workspace_id:workspaceId,name:"E2E B"}]);
 await admin.from("stock_items").insert({id:itemId,workspace_id:workspaceId,sku:`E2E-${id}`,name:"Rura testowa DN110",unit:"m"});
 await admin.from("stock_movements").insert({id:movementId,workspace_id:workspaceId,warehouse_id:warehouseA,movement_type:"PZ",status:"approved",approved_by:ownerUser.id,approved_at:new Date().toISOString()});
 await admin.from("stock_movement_lines").insert({workspace_id:workspaceId,movement_id:movementId,stock_item_id:itemId,quantity:10});
 const transfer=await api("/api/company/power",ownerToken,{workspaceId,action:"stock_transfer",payload:{warehouseId:warehouseA,targetWarehouseId:warehouseB,stockItemId:itemId,projectId:project.id,quantity:4,documentNumber:"E2E-MM"}});
 if(!transfer.response.ok)throw new Error(`Atomic MM failed: ${JSON.stringify(transfer.payload)}`);
 const {data:balances,error:balanceError}=await admin.rpc("get_stock_balances",{p_workspace_id:workspaceId});if(balanceError)throw balanceError;
 const a=Number(balances.find(row=>row.warehouse_id===warehouseA&&row.stock_item_id===itemId)?.quantity??0),b=Number(balances.find(row=>row.warehouse_id===warehouseB&&row.stock_item_id===itemId)?.quantity??0);if(a!==6||b!==4)throw new Error(`Stock ledger mismatch after MM: ${a}/${b}`);

 // Search must find the project and obey the owner's domains.
 const search=await api(`/api/company/search?workspaceId=${workspaceId}&q=${encodeURIComponent("E2E inwestycja")}`,ownerToken);
 if(!search.response.ok||!search.payload.results?.some(row=>row.entity_id===project.id))throw new Error("Company search did not return the project.");

 // 1.0 Command Center must return exactly 13 cash-flow weeks.
 const command=await api(`/api/projects/command-center?projectId=${project.id}`,ownerToken);
 if(!command.response.ok||command.payload.snapshot?.cashflow13w?.length!==13)throw new Error(`Command Center E2E failed: ${JSON.stringify(command.payload)}`);
 console.log("E2E CORE OK: roles, concurrent budget, stock ledger/MM, search, 13-week Command Center");
} finally {
 if(workspaceId)await admin.from("workspaces").delete().eq("id",workspaceId).catch(()=>undefined);
 if(ownerUser?.id)await admin.auth.admin.deleteUser(ownerUser.id).catch(()=>undefined);
 if(workerUser?.id)await admin.auth.admin.deleteUser(workerUser.id).catch(()=>undefined);
}
