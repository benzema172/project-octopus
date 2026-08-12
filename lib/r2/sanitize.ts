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

  if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (mimeType.includes("spreadsheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv")) {
    return "kosztorys";
  }

  if (lowerName.endsWith(".zip") || mimeType.includes("zip")) {
    return "paczka";
  }

  if (mimeType.includes("word") || lowerName.endsWith(".docx")) {
    return "dokument";
  }

  return "inne";
}

export function attachmentContentDisposition(fileName: string): string {
  const asciiName = sanitizeFileName(fileName).replace(/["\\]/g, "-");
  const encodedName = encodeURIComponent(fileName)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
