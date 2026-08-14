export const MAX_SUPPORTED_UPLOAD_BYTES = 50 * 1024 * 1024;
export const SUPPORTED_UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.zip,.xml,.txt,.json,.md";

const SUPPORTED_MIME_TYPES: Record<string, Set<string>> = {
  pdf: new Set(["application/pdf"]),
  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"]),
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]),
  csv: new Set(["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"]),
  png: new Set(["image/png"]),
  jpg: new Set(["image/jpeg", "image/jpg"]),
  jpeg: new Set(["image/jpeg", "image/jpg"]),
  webp: new Set(["image/webp"]),
  zip: new Set(["application/zip", "application/x-zip-compressed"]),
  xml: new Set(["application/xml", "text/xml", "text/plain"]),
  txt: new Set(["text/plain"]),
  json: new Set(["application/json", "text/json", "text/plain"]),
  md: new Set(["text/markdown", "text/plain"])
};

export function validateUploadFile(fileName: string, mimeType: string, fileSize?: number): string | null {
  const trimmedName = fileName.trim();
  const extension = trimmedName.includes(".") ? trimmedName.toLowerCase().split(".").at(-1) ?? "" : "";

  if (extension === "doc" || extension === "xls") {
    return "Format DOC/XLS wymaga konwersji. Zapisz plik jako DOCX/XLSX albo PDF i spróbuj ponownie.";
  }

  const allowedMimeTypes = SUPPORTED_MIME_TYPES[extension];
  if (!allowedMimeTypes) {
    return "Nieobsługiwany format. Dozwolone są PDF, DOCX, XLSX, CSV, obrazy, ZIP, XML i pliki tekstowe.";
  }

  if (typeof fileSize === "number" && fileSize > MAX_SUPPORTED_UPLOAD_BYTES) {
    return "Plik przekracza limit 50 MB pojedynczego dokumentu analizowanego przez AI.";
  }

  const normalizedMime = mimeType.trim().toLowerCase().split(";", 1)[0] || "application/octet-stream";
  if (normalizedMime !== "application/octet-stream" && !allowedMimeTypes.has(normalizedMime)) {
    return `Typ pliku ${normalizedMime} nie pasuje do rozszerzenia .${extension}.`;
  }

  return null;
}

export function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const normalized = trimmed
    .replaceAll("ł", "l")
    .replaceAll("Ł", "L")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 140);

  return safe || "document";
}

export function inferDocumentCategory(mimeType: string, fileName: string): string {
  const lowerName = fileName.toLowerCase();

  if (/kosztorys|przedmiar|boq|kalkulacj/.test(lowerName)) return "estimate";
  if (/stwi?or|specyfikacj.*technic/.test(lowerName)) return "specification";
  if (/projekt|rzut|schemat|pzt|pw[-_ ]|pb[-_ ]/.test(lowerName)) return "project";
  if (/faktur|invoice|ksef/.test(lowerName)) return "invoice";
  if (/protok[oó]ł|protokol|pr[oó]ba|odbior|zanikow/.test(lowerName)) return "protocol";
  if (/wniosek|wnioski|zatwierdzenie.*materia/.test(lowerName)) return "application";
  if (/wz[oó]r|szablon|template/.test(lowerName)) return "template";
  if (/umowa.*prac|badani|bhp|urlop|pracownik/.test(lowerName)) return "hr";
  if (/pojazd|samoch|flota|paliw|serwis/.test(lowerName)) return "fleet";

  if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (mimeType.includes("spreadsheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv")) {
    return "estimate";
  }

  if (lowerName.endsWith(".zip") || mimeType.includes("zip")) {
    return "package";
  }

  if (mimeType.includes("word") || lowerName.endsWith(".docx")) {
    return "document";
  }

  return "other";
}

export function attachmentContentDisposition(fileName: string): string {
  const asciiName = sanitizeFileName(fileName).replace(/["\\]/g, "-");
  const encodedName = encodeURIComponent(fileName)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
