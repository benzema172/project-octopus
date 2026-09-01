import type { DocumentCategory } from "@/lib/documents/classification";

export const MAX_SUPPORTED_UPLOAD_BYTES = 50 * 1024 * 1024;
export const SUPPORTED_UPLOAD_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.xml,.txt,.json,.md,.zip";

const SUPPORTED_MIME_TYPES: Record<string, Set<string>> = {
  pdf: new Set(["application/pdf"]),
  doc: new Set(["application/msword", "application/x-ole-storage", "application/x-cfb", "application/cdfv2"]),
  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"]),
  xls: new Set(["application/vnd.ms-excel", "application/x-ole-storage", "application/x-cfb", "application/cdfv2"]),
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]),
  csv: new Set(["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"]),
  png: new Set(["image/png"]),
  jpg: new Set(["image/jpeg", "image/jpg"]),
  jpeg: new Set(["image/jpeg", "image/jpg"]),
  webp: new Set(["image/webp"]),
  xml: new Set(["application/xml", "text/xml", "text/plain"]),
  txt: new Set(["text/plain"]),
  json: new Set(["application/json", "text/json", "text/plain"]),
  md: new Set(["text/markdown", "text/plain"]),
  zip: new Set(["application/zip", "application/x-zip-compressed"])
};

export function validateUploadFile(fileName: string, mimeType: string, fileSize?: number): string | null {
  const trimmedName = fileName.trim();
  const extension = trimmedName.includes(".") ? trimmedName.toLowerCase().split(".").at(-1) ?? "" : "";
  const allowedMimeTypes = SUPPORTED_MIME_TYPES[extension];
  if (!allowedMimeTypes) return "Nieobsługiwany format. Dozwolone są PDF, DOC/DOCX, XLS/XLSX, CSV, obrazy, XML, pliki tekstowe i kontrolowane paczki ZIP.";
  if (typeof fileSize === "number" && fileSize > MAX_SUPPORTED_UPLOAD_BYTES) return "Plik przekracza limit 50 MB pojedynczego dokumentu analizowanego przez AI.";
  const normalizedMime = mimeType.trim().toLowerCase().split(";", 1)[0] || "application/octet-stream";
  if (normalizedMime !== "application/octet-stream" && !allowedMimeTypes.has(normalizedMime)) return `Typ pliku ${normalizedMime} nie pasuje do rozszerzenia .${extension}.`;
  return null;
}

export function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const normalized = trimmed.replaceAll("ł", "l").replaceAll("Ł", "L").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 140);
  return safe || "document";
}

export function inferDocumentCategory(mimeType: string, fileName: string): DocumentCategory {
  const lowerName = fileName.toLocaleLowerCase("pl").replaceAll("ł", "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/kosztorys|przedmiar|boq|kalkulacj/.test(lowerName)) return "estimate";
  if (/stwi?or|specyfikacj.*technic/.test(lowerName)) return "specification";
  if (/projekt|dokumentacja|opis.*technic|rzut|schemat|pzt|pw[-_ ]|pb[-_ ]/.test(lowerName)) return "technical";
  if (/faktur|invoice|ksef/.test(lowerName)) return "invoice";
  if (/protokol|proba|odbior|zanikow/.test(lowerName)) return "protocol";
  if (/wniosek|wnioski|zatwierdzenie.*materia/.test(lowerName)) return "application";
  if (/harmonogram|schedule|terminarz/.test(lowerName)) return "schedule";
  if (/(^|[^a-z0-9])(wz|pz)([^a-z0-9]|$)|dostaw/.test(lowerName)) return "warehouse";
  if (/wz[oó]r|szablon|template/.test(lowerName)) return "template";
  if (/umowa.*prac|badani|bhp|urlop|pracownik/.test(lowerName)) return "hr";
  if (/pojazd|samoch|flota|paliw|serwis/.test(lowerName)) return "fleet";
  if (/umowa|kontrakt|aneks|zlecenie/.test(lowerName)) return "contract";
  if (/korespondencj|uzgodnieni|notatka|rfi|zapytani/.test(lowerName)) return "correspondence";
  if (/raport|zestawieni|podsumowani/.test(lowerName)) return "report";
  if (lowerName.endsWith(".zip") || mimeType.includes("zip")) return "other";
  if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) return "technical";
  if (mimeType.includes("spreadsheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv")) return "other";
  if (mimeType.includes("word") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "technical";
  return "other";
}

function contentDisposition(fileName: string, mode: "attachment" | "inline") {
  const asciiName = sanitizeFileName(fileName).replace(/["\\]/g, "-");
  const encodedName = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

export function attachmentContentDisposition(fileName: string): string {
  return contentDisposition(fileName, "attachment");
}

export function inlineContentDisposition(fileName: string): string {
  return contentDisposition(fileName, "inline");
}
