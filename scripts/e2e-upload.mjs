import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const requiredEnv=["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY","R2_ENDPOINT","R2_BUCKET_NAME","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"];
const missingEnv=requiredEnv.filter((name)=>!process.env[name]);
if(missingEnv.length){console.error(`Missing environment variables: ${missingEnv.join(", ")}`);process.exit(1);}

const baseUrl=process.env.E2E_BASE_URL??"http://localhost:3000";
const testId=randomUUID();
const email=`octopus-e2e-upload-${testId}@example.com`;
const password=`Octopus-${testId}-2026!`;
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const publicClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const r2=new S3Client({region:"auto",endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
let userId=null,workspaceId=null,accessToken=null,projectId=null;
const objectKeys=[];

async function uploadAndComplete({projectId:fileProjectId,fileName}){
  const content=`Project Octopus 1.1 e2e upload ${testId} ${fileName}\n`;
  const file=new Blob([content],{type:"text/plain"});
  const requestBody={fileName,mimeType:"text/plain",fileSize:file.size,...(fileProjectId?{projectId:fileProjectId}:{workspaceId})};
  const uploadUrlResponse=await fetch(`${baseUrl}/api/storage/upload-url`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(requestBody)});
  if(!uploadUrlResponse.ok)throw new Error(`Could not create upload URL (${fileName}): HTTP ${uploadUrlResponse.status} ${await uploadUrlResponse.text()}`);
  const upload=await uploadUrlResponse.json();
  const putResponse=await fetch(upload.uploadUrl,{method:"PUT",headers:upload.headers,body:file});
  if(!putResponse.ok)throw new Error(`R2 upload failed (${fileName}): HTTP ${putResponse.status}`);
  const hashBuffer=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
  const sha256=Array.from(new Uint8Array(hashBuffer)).map((byte)=>byte.toString(16).padStart(2,"0")).join("");
  const completeResponse=await fetch(`${baseUrl}/api/storage/complete`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({token:upload.token,sha256})});
  if(!completeResponse.ok)throw new Error(`Could not complete upload (${fileName}): HTTP ${completeResponse.status} ${await completeResponse.text()}`);
  const completed=await completeResponse.json();
  const {data:version,error:versionError}=await admin.from("document_versions").select("id,document_id,project_id,r2_object_key,r2_etag,sha256,upload_status,version_number").eq("id",completed.versionId).single();
  if(versionError||!version)throw new Error(`Could not verify ${fileName}: ${versionError?.message??"missing version"}`);
  objectKeys.push(version.r2_object_key);
  if(version.upload_status!=="uploaded"||version.sha256!==sha256||version.version_number!==1||!version.r2_etag)throw new Error(`Invalid document version metadata for ${fileName}.`);
  const {data:document,error:documentError}=await admin.from("documents").select("id,workspace_id,project_id,current_version_id").eq("id",completed.documentId).single();
  if(documentError||!document)throw new Error(`Could not verify document ${fileName}.`);
  if(fileProjectId&&document.project_id!==fileProjectId)throw new Error("Project upload lost its project scope.");
  if(!fileProjectId&&(document.project_id!==null||version.project_id!==null))throw new Error("Company-level upload was incorrectly assigned to a project.");
  const [{data:intake,error:intakeError},{data:job,error:jobError}]=await Promise.all([
    admin.from("document_intakes").select("status,document_id").eq("document_id",completed.documentId).single(),
    admin.from("processing_jobs").select("status,document_id,document_version_id,job_type").eq("document_version_id",completed.versionId).eq("job_type","document_pipeline").single()
  ]);
  if(intakeError||!intake||intake.status!=="queued")throw new Error(`Document intake was not queued for ${fileName}.`);
  if(jobError||!job||job.status!=="queued")throw new Error(`Processing job was not queued for ${fileName}.`);
  return {completed,version,document};
}

try{
  const {data:createdUser,error:createUserError}=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(createUserError||!createdUser.user)throw new Error(createUserError?.message??"User creation failed");
  userId=createdUser.user.id;
  const {data:session,error:signInError}=await publicClient.auth.signInWithPassword({email,password});
  if(signInError||!session.session)throw new Error(signInError?.message??"Sign-in failed");
  accessToken=session.session.access_token;
  const {data:workspace,error:workspaceError}=await admin.from("workspaces").insert({name:`Octopus upload E2E ${testId}`,owner_id:userId}).select("id").single();
  if(workspaceError||!workspace)throw new Error(workspaceError?.message??"Workspace creation failed");
  workspaceId=workspace.id;
  const {error:memberError}=await admin.from("workspace_members").insert({workspace_id:workspaceId,user_id:userId,role:"owner"});
  if(memberError)throw memberError;
  const {data:project,error:projectError}=await admin.from("projects").insert({workspace_id:workspaceId,name:`Upload E2E ${testId}`,status:"active",created_by:userId}).select("id").single();
  if(projectError||!project)throw new Error(projectError?.message??"Project creation failed");
  projectId=project.id;

  const projectUpload=await uploadAndComplete({projectId,fileName:`project-${testId}.txt`});
  const companyUpload=await uploadAndComplete({projectId:null,fileName:`company-${testId}.txt`});
  console.log(`E2E UPLOAD OK: project=${projectUpload.completed.documentId} company=${companyUpload.completed.documentId}`);
  console.log("E2E UPLOAD OK: R2 metadata, company-level null project, intake and processing queue verified");
} finally {
  for(const key of objectKeys){try{await r2.send(new DeleteObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:key}));}catch(error){console.error(`R2 cleanup failed for ${key}:`,error);}}
  try{if(workspaceId)await admin.from("workspaces").delete().eq("id",workspaceId);}catch{}
  try{if(userId)await admin.auth.admin.deleteUser(userId);}catch{}
}
