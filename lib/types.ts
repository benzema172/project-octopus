export type WorkspaceSummary = {
  id: string;
  name: string;
};

export type ProjectSummary = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  investor_name: string | null;
  general_contractor: string | null;
  location: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type DocumentSummary = {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  category: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  document_versions?: DocumentVersionSummary[];
};

export type DocumentVersionSummary = {
  id: string;
  document_id: string;
  project_id: string;
  version_number: number;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  r2_bucket: string;
  r2_object_key: string;
  sha256: string | null;
  upload_status: string;
  uploaded_at: string | null;
  created_at: string;
};

export type AuthenticatedUser = {
  id: string;
  email?: string;
};
