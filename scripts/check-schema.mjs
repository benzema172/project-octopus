import { createClient } from "@supabase/supabase-js";

const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const checks = [
  ["workspaces", "id,name,owner_id,created_at,updated_at"],
  ["workspace_members", "workspace_id,user_id,role,created_at"],
  ["projects", "id,workspace_id,name,description,investor_name,general_contractor,location,status,created_by,created_at,updated_at"],
  ["documents", "id,workspace_id,project_id,name,category,current_version_id,created_by,deleted_at,deleted_by,created_at,updated_at"],
  [
    "document_versions",
    "id,document_id,project_id,version_number,file_name,mime_type,file_size_bytes,r2_bucket,r2_object_key,r2_etag,sha256,upload_status,uploaded_by,uploaded_at,created_at"
  ],
  ["document_pages", "id,document_version_id,page_number,text_content,created_at"],
  ["document_chunks", "id,document_version_id,page_id,chunk_index,content,embedding,metadata,created_at"],
  ["project_facts", "id,project_id,fact_type,value_text,value_json,confidence,source_reference_id,created_at,updated_at"],
  ["source_references", "id,project_id,document_id,document_version_id,page_number,section_label,quote,created_at"],
  ["materials", "id,project_id,name,installation,specification,source_reference_id,created_at,updated_at"],
  ["devices", "id,project_id,name,installation,parameters,source_reference_id,created_at,updated_at"],
  ["boq_items", "id,project_id,item_number,description,quantity,unit,unit_price,total_price,source_reference_id,created_at,updated_at"],
  ["material_requests", "id,project_id,title,status,payload,created_by,created_at,updated_at"],
  ["protocols", "id,project_id,protocol_type,title,status,payload,created_by,created_at,updated_at"],
  ["schedule_items", "id,project_id,title,starts_on,ends_on,status,created_at,updated_at"],
  ["ai_runs", "id,project_id,provider,model,status,input,output,error,created_by,created_at,updated_at"],
  ["ai_findings", "id,project_id,ai_run_id,finding_type,severity,title,description,source_reference_id,created_at"],
  ["app_schema_versions", "version,applied_at"]
];

let failed = false;

for (const [table, columns] of checks) {
  const { error } = await supabase.from(table).select(columns).limit(1);

  if (error) {
    failed = true;
    console.error(`FAIL ${table}: ${error.message}`);
  } else {
    console.log(`OK   ${table}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("Schema matches the Project Octopus MVP requirements.");
