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

