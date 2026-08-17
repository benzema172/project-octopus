from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


path = Path("lib/r2/sanitize.ts")
s = path.read_text()
s = replace_once(
    s,
    'export const SUPPORTED_UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.zip,.xml,.txt,.json,.md";',
    'export const SUPPORTED_UPLOAD_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.zip,.xml,.txt,.json,.md";',
    "accept list",
)
s = replace_once(
    s,
    '  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"]),',
    '  doc: new Set(["application/msword", "application/x-ole-storage", "application/x-cfb", "application/cdfv2"]),\n  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"]),',
    "doc mime",
)
s = replace_once(
    s,
    '  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]),',
    '  xls: new Set(["application/vnd.ms-excel", "application/x-ole-storage", "application/x-cfb", "application/cdfv2"]),\n  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]),',
    "xls mime",
)
s = replace_once(
    s,
    '  if (extension === "doc" || extension === "xls") {\n    return "Format DOC/XLS wymaga konwersji. Zapisz plik jako DOCX/XLSX albo PDF i spróbuj ponownie.";\n  }\n\n',
    '',
    "legacy rejection",
)
s = s.replace(
    'return "Nieobsługiwany format. Dozwolone są PDF, DOCX, XLSX, CSV, obrazy, ZIP, XML i pliki tekstowe.";',
    'return "Nieobsługiwany format. Dozwolone są PDF, DOC/DOCX, XLS/XLSX, CSV, obrazy, ZIP, XML i pliki tekstowe.";',
)
s = replace_once(
    s,
    'if (mimeType.includes("word") || lowerName.endsWith(".docx")) {',
    'if (mimeType.includes("word") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) {',
    "doc category",
)
path.write_text(s)

path = Path("lib/ai/office-extractor.ts")
s = path.read_text()
s = replace_once(
    s,
    'import "server-only";\n\nimport { inflateRawSync } from "node:zlib";',
    'import "server-only";\n\nimport { createRequire } from "node:module";\nimport { inflateRawSync } from "node:zlib";',
    "office imports",
)
s = replace_once(
    s,
    "const MAX_TOTAL_BYTES = 36 * 1024 * 1024;\n",
    '''const MAX_TOTAL_BYTES = 36 * 1024 * 1024;\nconst requireNode = createRequire(import.meta.url);\n\ntype LegacyWordDocument = {\n  getBody?: () => string;\n  getFootnotes?: () => string;\n  getEndnotes?: () => string;\n  getHeaders?: (options?: { includeFooters?: boolean }) => string;\n  getFooters?: () => string;\n  getAnnotations?: () => string;\n  getTextboxes?: (options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }) => string;\n};\ntype LegacyWordExtractor = { extract: (input: Buffer) => Promise<LegacyWordDocument> };\nconst WordExtractor = requireNode("word-extractor") as new () => LegacyWordExtractor;\nconst XLSX = requireNode("xlsx") as typeof import("xlsx");\n''',
    "legacy parser setup",
)
legacy_functions = r'''function safeLegacySection(reader: (() => string) | undefined) {
  if (!reader) return "";
  try {
    return reader().replace(/\u0000/g, "").trim();
  } catch {
    return "";
  }
}

export async function extractLegacyDocText(buffer: Buffer) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  const sections = [
    ["Treść", safeLegacySection(document.getBody?.bind(document))],
    ["Nagłówki", safeLegacySection(document.getHeaders?.bind(document, { includeFooters: false }))],
    ["Stopki", safeLegacySection(document.getFooters?.bind(document))],
    ["Przypisy", safeLegacySection(document.getFootnotes?.bind(document))],
    ["Przypisy końcowe", safeLegacySection(document.getEndnotes?.bind(document))],
    ["Komentarze", safeLegacySection(document.getAnnotations?.bind(document))],
    ["Pola tekstowe", safeLegacySection(document.getTextboxes?.bind(document, { includeHeadersAndFooters: true, includeBody: true }))]
  ].filter((section) => section[1]);
  const text = sections.map(([label, value]) => `[${label}]\n${value}`).join("\n\n").trim();
  if (!text) throw new Error("Nie udało się odczytać tekstu ze starego pliku DOC.");
  return text;
}

export function extractLegacyXlsText(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, sheetRows: 20_000 });
  const sheets: string[] = [];
  for (const name of workbook.SheetNames.slice(0, 100)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false }) as unknown[][];
    const lines = rows.slice(0, 20_000).map((row) => row.map((value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim()).join("\t"));
    sheets.push(`[Arkusz: ${name}]\n${lines.join("\n")}`);
  }
  const text = sheets.join("\n\n").trim();
  if (!text) throw new Error("Nie udało się odczytać komórek ze starego pliku XLS.");
  return text;
}

'''
s = replace_once(
    s,
    "export function listZipContents(buffer: Buffer) {",
    legacy_functions + "export function listZipContents(buffer: Buffer) {",
    "legacy extractors insertion",
)
path.write_text(s)

path = Path("lib/ai/process-document.ts")
s = path.read_text()
s = replace_once(
    s,
    'import { extractDocxText, extractXlsxText, listZipContents } from "@/lib/ai/office-extractor";',
    'import { extractDocxText, extractLegacyDocText, extractLegacyXlsText, extractXlsxText, listZipContents } from "@/lib/ai/office-extractor";',
    "process import",
)
s = replace_once(
    s,
    "function prepareInput(fileName: string, mimeType: string, bytes: Buffer) {",
    "async function prepareInput(fileName: string, mimeType: string, bytes: Buffer) {",
    "async prepareInput",
)
s = replace_once(
    s,
    '  if (ext === "docx") return { extractedText: extractDocxText(bytes) };\n  if (ext === "xlsx") return { extractedText: extractXlsxText(bytes) };',
    '  if (ext === "doc") return { extractedText: await extractLegacyDocText(bytes) };\n  if (ext === "docx") return { extractedText: extractDocxText(bytes) };\n  if (ext === "xls") return { extractedText: extractLegacyXlsText(bytes) };\n  if (ext === "xlsx") return { extractedText: extractXlsxText(bytes) };',
    "legacy prepare branches",
)
s = replace_once(
    s,
    '  if (ext === "xls" || ext === "doc") throw new Error("Starszy format wymaga konwersji do XLSX/DOCX przed analizą.");\n',
    '',
    "legacy process rejection",
)
s = replace_once(
    s,
    '    const prepared = useFilesApi ? {} : prepareInput(version.file_name, version.mime_type, bytes);',
    '    const prepared = useFilesApi ? {} : await prepareInput(version.file_name, version.mime_type, bytes);',
    "await prepareInput",
)
path.write_text(s)

path = Path("components/documents/document-upload.tsx")
s = path.read_text()
s = replace_once(
    s,
    "PDF, Word, Excel, obrazy, XML i ZIP · do {MAX_SUPPORTED_UPLOAD_BYTES / 1024 / 1024} MB",
    "PDF, DOC/DOCX, XLS/XLSX, CSV, obrazy, XML i ZIP · do {MAX_SUPPORTED_UPLOAD_BYTES / 1024 / 1024} MB",
    "upload hint",
)
path.write_text(s)
