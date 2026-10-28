import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type ExactDuplicateCandidate = {
  candidate_document_id: string;
  candidate_version_id: string;
};

// Pure read-only gate. Call BEFORE project enrichment and before auto-publish.
// All rows are scoped to a single company; never infer duplicate identity
// from file names or model similarity alone.
export async function findExistingExactDuplicate(input: {
  workspaceId: string;
  documentId: string;
  versionId: string;
}): Promise<ExactDuplicateCandidate | null> {
  const db = createServiceSupabaseClient();
  const { data: version, error: versionError } = await db.from("document_versions")
    .select("sha256").eq("document_id", input.documentId).eq("id", input.versionId)
    .maybeSingle<{ sha256: string | null }>();
  if (versionError || !version) {
    throw new Error(`Kontrola identyczności dokumentu: ${versionError?.message ?? "brak wersji"}`);
  }
  if (!version.sha256) {
    // No SHA is not proof that the file is unique. Extraction must calculate it.
    throw new Error("Brak zweryfikowanej sumy SHA-256. Routing i publikacja są wstrzymane.");
  }
  const { data, error } = await db.rpc("find_document_sha256_duplicate_20261028", {
    p_workspace_id: input.workspaceId,
    p_document_id: input.documentId,
    p_sha256: version.sha256
  });
  if (error) throw new Error(`Kontrola duplikatów niedostępna: ${error.message}`);
  if (!Array.isArray(data)) {
    // Unknown RPC result shape is not equivalent to "no duplicate".
    throw new Error("Nieprawidłowy wynik kontroli SHA-256. Publikacja jest wstrzymana.");
  }
  const rows = data as ExactDuplicateCandidate[];
  return rows[0] ?? null;
}
