import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentSummary } from "@/lib/types";

export async function listDocumentsForProject(projectId: string): Promise<DocumentSummary[]> {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, project_id, workspace_id, name, category, current_version_id, created_at, updated_at, document_versions(id, document_id, project_id, version_number, file_name, mime_type, file_size_bytes, r2_bucket, r2_object_key, sha256, upload_status, uploaded_at, created_at)"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .returns<DocumentSummary[]>();

  if (error) {
    throw new Error(`Nie udało się pobrać dokumentów: ${error.message}`);
  }

  return data ?? [];
}
