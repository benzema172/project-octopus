import "server-only";

import { inflateRawSync } from "node:zlib";

export type ExtractedPage = {
  pageNumber: number;
  label: string;
  text: string;
};

export type ExtractedDocument = {
  method: "local" | "gemini-pdf";
  pages: ExtractedPage[];
  text: string;
  truncated: boolean;
};

const MAX_EXTRACTED_CHARS = 500_000;
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 65_557);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  throw new Error("Nie znaleziono katalogu ZIP w pliku Office.");
}

function readZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, Buffer>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_HEADER) {
      throw new Error("Uszkodzony katalog ZIP w pliku Office.");
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");

    if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_HEADER) {
      throw new Error("Uszkodzony nagłówek ZIP w pliku Office.");
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    if (!fileName.endsWith("/")) {
      if (compressionMethod === 0) {
        entries.set(fileName, Buffer.from(compressed));
      } else if (compressionMethod === 8) {
        entries.set(fileName, inflateRawSync(compressed));
      }
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function xmlText(xml: string) {
  const prepared = xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<w:br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<a:br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<\/w:tr>/gi, "\n")
    .replace(/<\/a:p>/gi, "\n")
    .replace(/<\/row>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return cleanText(decodeXml(prepared));
}

function extractDocx(buffer: Buffer): ExtractedDocument {
  const entries = readZipEntries(buffer);
  const parts: string[] = [];
  const orderedFiles = [
    ...Array.from(entries.keys()).filter((name) => /^word\/header\d+\.xml$/i.test(name)).sort(),
    "word/document.xml",
    ...Array.from(entries.keys()).filter((name) => /^word\/footer\d+\.xml$/i.test(name)).sort()
  ];

  for (const fileName of orderedFiles) {
    const entry = entries.get(fileName);
    if (!entry) continue;
    const text = xmlText(entry.toString("utf8"));
    if (text) parts.push(text);
  }

  const text = cleanText(parts.join("\n\n"));
  if (!text) throw new Error("Nie udało się wydobyć tekstu z DOCX.");

  const truncated = text.length > MAX_EXTRACTED_CHARS;
  const finalText = truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text;

  return {
    method: "local",
    pages: [{ pageNumber: 1, label: "Dokument Word", text: finalText }],
    text: finalText,
    truncated
  };
}

function sharedStrings(entries: Map<string, Buffer>) {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [] as string[];

  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)).map((match) => {
    const texts = Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)).map((item) => decodeXml(item[1]));
    return cleanText(texts.join(""));
  });
}

function cellValue(cellXml: string, strings: string[]) {
  const type = cellXml.match(/\bt="([^"]+)"/i)?.[1] ?? "";
  const inlineText = Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)).map((match) => decodeXml(match[1])).join("");
  if (inlineText) return cleanText(inlineText);

  const raw = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1]?.trim() ?? "";
  if (!raw) return "";
  if (type === "s") return strings[Number(raw)] ?? raw;
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return decodeXml(raw);
}

function sheetNameMap(entries: Map<string, Buffer>) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationTargets = new Map<string, string>();

  for (const match of rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?\s*>/gi)) {
    const target = match[2].replace(/^\//, "").replace(/^\.\//, "");
    relationTargets.set(match[1], target.startsWith("xl/") ? target : `xl/${target}`);
  }

  const result = new Map<string, string>();
  for (const match of workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?\s*>/gi)) {
    const target = relationTargets.get(match[2]);
    if (target) result.set(target, decodeXml(match[1]));
  }

  return result;
}

function extractXlsx(buffer: Buffer): ExtractedDocument {
  const entries = readZipEntries(buffer);
  const strings = sharedStrings(entries);
  const names = sheetNameMap(entries);
  const sheetFiles = Array.from(entries.keys()).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const pages: ExtractedPage[] = [];

  for (let sheetIndex = 0; sheetIndex < sheetFiles.length; sheetIndex += 1) {
    const fileName = sheetFiles[sheetIndex];
    const xml = entries.get(fileName)?.toString("utf8") ?? "";
    const lines: string[] = [];

    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const values = Array.from(rowMatch[1].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/gi))
        .map((cell) => cellValue(cell[0], strings))
        .map((value) => value.replace(/[\t\n]+/g, " ").trim());
      if (values.some(Boolean)) lines.push(values.join("\t"));
    }

    const text = cleanText(lines.join("\n"));
    if (text) {
      pages.push({ pageNumber: sheetIndex + 1, label: names.get(fileName) ?? `Arkusz ${sheetIndex + 1}`, text });
    }
  }

  if (!pages.length) throw new Error("Nie udało się wydobyć danych z XLSX.");

  let text = pages.map((page) => `### ${page.label}\n${page.text}`).join("\n\n");
  const truncated = text.length > MAX_EXTRACTED_CHARS;
  if (truncated) text = text.slice(0, MAX_EXTRACTED_CHARS);

  return { method: "local", pages, text, truncated };
}

function extractDelimited(buffer: Buffer, fileName: string): ExtractedDocument {
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const truncated = raw.length > MAX_EXTRACTED_CHARS;
  const text = cleanText(truncated ? raw.slice(0, MAX_EXTRACTED_CHARS) : raw);
  if (!text) throw new Error(`Plik ${fileName} nie zawiera tekstu.`);
  return { method: "local", pages: [{ pageNumber: 1, label: fileName, text }], text, truncated };
}

export function canExtractLocally(fileName: string) {
  return /\.(docx|xlsx|csv|txt)$/i.test(fileName);
}

export function isPdfFile(fileName: string, mimeType: string) {
  return mimeType.includes("pdf") || /\.pdf$/i.test(fileName);
}

export function extractLocalDocument(buffer: Buffer, fileName: string): ExtractedDocument {
  if (/\.docx$/i.test(fileName)) return extractDocx(buffer);
  if (/\.xlsx$/i.test(fileName)) return extractXlsx(buffer);
  if (/\.(csv|txt)$/i.test(fileName)) return extractDelimited(buffer, fileName);

  if (/\.(doc|xls)$/i.test(fileName)) {
    throw new Error("Stary format DOC/XLS jest przechowywany, ale do analizy AI wymaga konwersji do DOCX/XLSX.");
  }

  throw new Error("Ten format nie ma jeszcze lokalnego ekstraktora tekstu.");
}

export function chunkExtractedPages(pages: ExtractedPage[], maxChars = 4200, overlap = 280) {
  const chunks: Array<{ pageNumber: number; label: string; content: string; chunkIndex: number }> = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const source = page.text.trim();
    if (!source) continue;

    let cursor = 0;
    while (cursor < source.length) {
      const hardEnd = Math.min(source.length, cursor + maxChars);
      let end = hardEnd;

      if (hardEnd < source.length) {
        const lastBreak = Math.max(source.lastIndexOf("\n", hardEnd), source.lastIndexOf(". ", hardEnd));
        if (lastBreak > cursor + Math.floor(maxChars * 0.55)) end = lastBreak + 1;
      }

      const content = source.slice(cursor, end).trim();
      if (content) chunks.push({ pageNumber: page.pageNumber, label: page.label, content, chunkIndex: chunkIndex++ });
      if (end >= source.length) break;
      cursor = Math.max(end - overlap, cursor + 1);
    }
  }

  return chunks;
}
