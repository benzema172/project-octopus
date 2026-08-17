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
  [
    "documents",
    "id,workspace_id,project_id,name,category,current_version_id,ai_status,ai_confidence,retention_until,legal_hold,created_by,deleted_at,deleted_by,created_at,updated_at"
  ],
  [
    "document_versions",
    "id,document_id,project_id,version_number,file_name,mime_type,file_size_bytes,r2_bucket,r2_object_key,r2_etag,sha256,upload_status,security_status,security_report,security_scanned_at,uploaded_by,uploaded_at,created_at"
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
  ["entity_links", "id,workspace_id,document_id,source_type,source_id,target_type,target_id,relation_type,confidence,created_at"],
  ["document_intakes", "id,workspace_id,document_id,status,channel,suggested_category,proposed_project_id,confidence,created_at,decided_at"],
  ["processing_jobs", "id,workspace_id,document_id,document_version_id,job_type,status,attempt_count,job_key,created_at,updated_at"],
  ["document_classifications", "id,workspace_id,document_id,category,subcategory,confidence,model_name,status,created_at"],
  ["document_extractions", "id,workspace_id,document_id,document_version_id,extraction_type,payload,status,created_at"],
  ["approvals", "id,workspace_id,entity_type,entity_id,status,requested_by,decided_by,created_at"],
  ["tasks", "id,workspace_id,project_id,title,status,priority,assigned_to,due_at,created_at,updated_at"],
  ["audit_events", "id,workspace_id,actor_id,event_type,entity_type,entity_id,before_value,after_value,created_at"],
  ["wbs_nodes", "id,workspace_id,project_id,parent_id,code,name,sort_order,status,created_at"],
  ["project_requirements", "id,workspace_id,project_id,requirement_type,title,status,source_document_id,created_at"],
  ["schedule_baselines", "id,workspace_id,project_id,name,status,start_date,finish_date,created_at"],
  ["progress_periods", "id,workspace_id,project_id,period_start,period_end,status,created_at"],
  ["invoices", "id,workspace_id,invoice_number,direction,status,issue_date,due_date,gross_amount,currency,created_at"],
  ["budgets", "id,workspace_id,project_id,name,status,total_revenue,total_cost,currency,created_at"],
  ["employees", "id,workspace_id,first_name,last_name,status,created_at"],
  ["warehouses", "id,workspace_id,name,location,created_at"],
  ["stock_items", "id,workspace_id,sku,name,unit,created_at"],
  ["vehicles", "id,workspace_id,registration_number,vehicle_type,status,created_at"],
  ["templates", "id,workspace_id,name,template_type,status,created_at,updated_at"],
  ["generation_runs", "id,workspace_id,project_id,template_version_id,status,input_snapshot,warnings,created_at"],
  ["generated_documents", "id,workspace_id,project_id,generation_run_id,document_id,output_format,status,created_at"],
  ["report_definitions", "id,workspace_id,name,report_type,active,created_at,updated_at"],
  ["document_texts", "id,workspace_id,project_id,document_id,document_version_id,extracted_text,extraction_method,quality_score,created_at,updated_at"],
  ["ai_review_actions", "id,workspace_id,project_id,document_id,entity_type,entity_id,action,next_status,decided_by,created_at"],
  ["domain_role_grants", "id,workspace_id,user_id,domain,access_level,project_id,valid_from,valid_until,created_at"],
  ["estimate_imports", "id,workspace_id,project_id,document_id,document_version_id,status,detected_rows,accepted_rows,created_at,updated_at"],
  ["estimate_import_rows", "id,workspace_id,estimate_import_id,source_row,description,quantity,unit,unit_price,total_price,proposed_wbs_code,status"],
  ["wbs_dependencies", "id,workspace_id,project_id,predecessor_id,successor_id,dependency_type,lag_days"],
  ["schedule_activities", "id,workspace_id,project_id,schedule_baseline_id,wbs_node_id,title,planned_start,planned_finish,status"],
  ["material_chain_events", "id,workspace_id,project_id,wbs_node_id,boq_item_id,stage,source_type,quantity,amount,status,occurred_at"],
  ["evidence_requirements", "id,workspace_id,project_id,wbs_node_id,boq_item_id,evidence_type,title,status,source_reference_id"],
  ["document_change_impacts", "id,workspace_id,project_id,document_id,from_version_id,to_version_id,impact_type,target_type,summary,risk_level,status"],
  ["forecast_snapshots", "id,workspace_id,project_id,forecast_date,forecast_finish_date,actual_cost,committed_cost,estimate_to_complete,estimate_at_completion,forecast_margin"],
  ["site_events", "id,workspace_id,project_id,event_type,title,captured_at,location_label,geo_point,attachments,status"],
  ["closeout_requirements", "id,workspace_id,project_id,category,title,status,document_id,owner_id,due_at"],
  ["knowledge_entries", "id,workspace_id,source_project_id,entry_type,title,summary,tags,status,created_at,updated_at"],
  ["document_generation_sources", "id,workspace_id,generation_run_id,source_type,source_id,document_version_id,locator"],
  ["ksef_connections", "id,workspace_id,environment,status,nip,inbound_enabled,sales_enabled,last_successful_sync_at"],
  ["ksef_sync_runs", "id,workspace_id,connection_id,direction,status,received_count,error_message,created_at"],
  ["ksef_inbox_items", "id,workspace_id,ksef_number,invoice_number,supplier_nip,status,received_at"],
  ["integration_connections", "id,workspace_id,integration_type,display_name,status,configuration,last_sync_at"],
  ["notification_rules", "id,workspace_id,project_id,event_type,channels,recipients,lead_time_days,active"],
  ["notifications", "id,workspace_id,project_id,user_id,event_type,title,severity,read_at,created_at"],
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

const { data: schemaMarker, error: markerError } = await supabase
  .from("app_schema_versions")
  .select("version")
  .eq("version", "20260817_upload_security_and_atomic_document_review")
  .maybeSingle();

if (markerError || !schemaMarker) {
  console.error(`FAIL app_schema_versions: ${markerError?.message ?? "missing 20260817_upload_security_and_atomic_document_review marker"}`);
  process.exit(1);
}

console.log("Schema matches the Project Octopus 0.7.2 upload security, atomic review and publication requirements.");
