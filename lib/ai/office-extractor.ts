import "server-only";

import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";

const MAX_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 36 * 1024 * 1024;
const requireNode = createRequire(import.meta.url);

type LegacyWordDocument = {
  getBody?: () => string;
  getFootnotes?: () => string;
  getEndnotes?: () => string;
  getHeaders?: (options?: { includeFooters?: boolean }) => string;
  getFooters?: () => string;
  getAnnotations?: () => string;
  getTextboxes?: (options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }) => string;
};
type LegacyWordExtractor = { extract: (input: Buffer) => Promise<LegacyWordDocument> };
const WordExtractor = requireNode("word-extractor") as new () => LegacyWordExtractor;
const XLSX = requireNode("xlsx") as typeof import("xlsx");

type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Nie znaleziono katalogu centralnego ZIP.");
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Nieprawidłowy wpis katalogu ZIP.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(buffer: Buffer, entry: ZipEntry) {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Wpis ZIP ${entry.name} jest zbyt duży.`);
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("Nieprawidłowy lokalny nagłówek ZIP.");
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  throw new Error(`Nieobsługiwana metoda kompresji ZIP: ${entry.method}.`);
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textNodes(xml: string) {
  return decodeXml(Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((match) => match[1]).join(""));
}

function columnNumber(reference: string) {
  const letters = reference.replace(/[^A-Z]/gi, "").toUpperCase();
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(1, result);
}

export function extractDocxText(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
  if (!documentEntry) throw new Error("DOCX nie zawiera word/document.xml.");
  const xml = extractZipEntry(buffer, documentEntry).toString("utf8");
  return decodeXml(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
  ).replace(/\n{3,}/g, "\n\n").trim();
}

export function extractXlsxText(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const sharedStrings = sharedEntry
    ? Array.from(extractZipEntry(buffer, sharedEntry).toString("utf8").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)).map((match) => textNodes(match[1]))
    : [];
  const sheetEntries = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));
  let totalBytes = 0;
  const sheets: string[] = [];

  for (const entry of sheetEntries) {
    totalBytes += entry.uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) break;
    const xml = extractZipEntry(buffer, entry).toString("utf8");
    const lines: string[] = [`[Arkusz: ${entry.name.split("/").at(-1)}]`];
    for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const values: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? "A1";
        const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? textNodes(body);
        const value = type === "s" ? sharedStrings[Number(raw)] ?? raw : decodeXml(raw);
        const index = columnNumber(reference) - 1;
        while (values.length < index) values.push("");
        values[index] = value;
      }
      if (values.some(Boolean)) lines.push(values.join("\t"));
    }
    sheets.push(lines.join("\n"));
  }

  return sheets.join("\n\n").trim();
}

function safeLegacySection(reader: (() => string) | undefined) {
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

export function listZipContents(buffer: Buffer) {
  return readZipEntries(buffer)
    .filter((entry) => !entry.name.endsWith("/"))
    .slice(0, 500)
    .map((entry) => `${entry.name}\t${entry.uncompressedSize} B`)
    .join("\n");
}
