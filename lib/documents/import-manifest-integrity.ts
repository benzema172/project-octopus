// Shared deterministic rules for resumable import manifests.
// No automatic reuse is allowed unless every position has the same SHA-256.
export type ImportManifestFile = {
  relativePath: string;
  fileName: string;
  fileSize: number;
  sha256: string;
};
export type StoredImportManifestItem = {
  ordinal: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number;
  file_sha256: string | null;
  upload_status?: string;
  document_id?: string | null;
  document_version_id?: string | null;
};

export function normalizeImportSha256(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-f\d]{64}$/i.test(value)) return null;
  return value.toLowerCase();
}
export function cleanImportRelativePath(value: string, fallback: string): string {
  return String(value || fallback).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").slice(0, 900);
}
export function matchesImportManifest(items: StoredImportManifestItem[], files: ImportManifestFile[]): boolean {
  if (items.length !== files.length) return false;
  return items.every((item, index) => {
    const file = files[index];
    const fileName = String(file.fileName || "").trim().slice(0, 500) || `Plik ${index + 1}`;
    const digest = normalizeImportSha256(file.sha256);
    return item.ordinal === index + 1
      && item.file_name === fileName
      && item.relative_path === cleanImportRelativePath(file.relativePath, fileName)
      && Number(item.file_size_bytes) === Math.max(0, Math.round(Number(file.fileSize) || 0))
      && Boolean(digest) && item.file_sha256 === digest;
  });
}
export function fullyUploadedImport(items: StoredImportManifestItem[], expectedFiles: number): boolean {
  return items.length === expectedFiles && items.every((item) =>
    item.upload_status === "uploaded" && Boolean(item.document_id) && Boolean(item.document_version_id)
  );
}
