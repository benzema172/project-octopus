import "server-only";

import { decodeXmlEntities, readZipFiles } from "@/lib/documents/archive";

export type ExtractedPage = {
  pageNumber: number;
  label: string | null;
  text: string;
};

export type ExtractedDocument = {
  text: string;
  pages: ExtractedPage[];
  method: "docx" | "xlsx" | "csv" | "pdf-gemini";
  warnings: string[];
};

const MAX_EXTRACTED_CHARS = 700_000;

function capText(value: string, warnings: string[]) {
  const compact = value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (compact.length <= MAX_EXTRACTED_CHARS) return compact;
  warnings.push(`Treść przekroczyła ${MAX_EXTRACTED_CHARS.toLocaleString("pl-PL")} znaków i została skrócona przed analizą AI.`);
  return compact.slice(0, MAX_EXTRACTED_CHARS);
}

function xmlText(value: string) {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, ""));
}

function extractDocx(buffer: Buffer): ExtractedDocument {
  const files = readZipFiles(buffer);
  const warnings: string[] = [];
  const candidates = [...files.keys()]
    .filter((name) => name === "word/document.xml" || /^word\/(header|footer)\d+\.xml$/.test(name))
    .sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));

  if (!candidates.length) throw new Error("Plik DOCX nie zawiera dokumentu Word.");

  const parts = candidates.map((name) => {
    const xml = files.get(name)?.toString("utf8") ?? "";
    const withBreaks = xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n");
    return xmlText(withBreaks);
  });

  const text = capText(parts.join("\n"), warnings);
  return {
    text,
    pages: [{ pageNumber: 1, label: "DOCX", text }],
    method: "docx",
    warnings
  };
}

function sharedStrings(xml: string) {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const fragments = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXmlEntities(item[1]));
    strings.push(fragments.join(""));
  }
  return strings;
}

function workbookSheetNames(files: Map<string, Buffer>) {
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationTargets = new Map<string, string>();

  for (const match of rels.matchAll(/<Relationship\b([^>]+)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = match[1];
    const id = attrs.match(/Id="([^"]+)"/)?.[1];
    const target = attrs.match(/Target="([^"]+)"/)?.[1];
    if (id && target) relationTargets.set(id, target.replace(/^\//, ""));
  }

  const names = new Map<string, string>();
  for (const match of workbook.matchAll(/<sheet\b([^>]+)\/?>(?:<\/sheet>)?/g)) {
    const attrs = match[1];
    const name = decodeXmlEntities(attrs.match(/name="([^"]+)"/)?.[1] ?? "Arkusz");
    const relationId = attrs.match(/r:id="([^"]+)"/)?.[1];
    if (!relationId) continue;
    let target = relationTargets.get(relationId);
    if (!target) continue;
    if (!target.startsWith("xl/")) target = `xl/${target.replace(/^\.\//, "")}`;
    names.set(target, name);
  }
  return names;
}

function cellText(cellXml: string, shared: string[]) {
  const type = cellXml.match(/<c\b[^>]*\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1])).join("");
  }
  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return shared[Number(value)] ?? value;
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return decodeXmlEntities(value);
}

function extractXlsx(buffer: Buffer): ExtractedDocument {
  const files = readZipFiles(buffer);
  const warnings: string[] = [];
  const shared = sharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const sheetNames = workbookSheetNames(files);
  const sheetPaths = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();
  if (!sheetPaths.length) throw new Error("Plik XLSX nie zawiera arkuszy.");

  const pages: ExtractedPage[] = [];
  for (const [sheetIndex, path] of sheetPaths.entries()) {
    const xml = files.get(path)?.toString("utf8") ?? "";
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [...row[1].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)].map((cell) => cellText(cell[0], shared));
      if (values.some((value) => value.trim().length)) rows.push(values.join("\t"));
      if (rows.join("\n").length > 180_000) {
        warnings.push(`Arkusz ${sheetNames.get(path) ?? sheetIndex + 1} został skrócony ze względu na rozmiar.`);
        break;
      }
    }
    const label = sheetNames.get(path) ?? `Arkusz ${sheetIndex + 1}`;
    pages.push({ pageNumber: sheetIndex + 1, label, text: `### ${label}\n${rows.join("\n")}`.trim() });
  }

  const text = capText(pages.map((page) => page.text).join("\n\n"), warnings);
  return { text, pages, method: "xlsx", warnings };
}

function extractCsv(buffer: Buffer): ExtractedDocument {
  const warnings: string[] = [];
  const text = capText(buffer.toString("utf8"), warnings);
  return { text, pages: [{ pageNumber: 1, label: "CSV", text }], method: "csv", warnings };
}

export function extractLocalDocument(buffer: Buffer, fileName: string, mimeType: string): ExtractedDocument | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx") || mimeType.includes("wordprocessingml")) return extractDocx(buffer);
  if (lower.endsWith(".xlsx") || mimeType.includes("spreadsheetml")) return extractXlsx(buffer);
  if (lower.endsWith(".csv") || mimeType.includes("csv")) return extractCsv(buffer);
  if (lower.endsWith(".doc") || lower.endsWith(".xls")) {
    throw new Error("Starszy format DOC/XLS nie ma bezpiecznego parsera w MVP. Zapisz plik jako DOCX/XLSX albo PDF i wrzuć ponownie.");
  }
  if (lower.endsWith(".pdf") || mimeType.includes("pdf")) return null;
  throw new Error("Ten format nie jest obsługiwany przez ekstrakcję dokumentów.");
}

export function chunkText(text: string, maxChars = 4_000, overlap = 350) {
  const chunks: string[] = [];
  let offset = 0;
  const normalized = text.trim();
  while (offset < normalized.length) {
    let end = Math.min(offset + maxChars, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf(". ", end));
      if (boundary > offset + Math.floor(maxChars * 0.55)) end = boundary + 1;
    }
    const chunk = normalized.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    offset = Math.max(offset + 1, end - overlap);
  }
  return chunks;
}
