import { createHash } from "node:crypto";
import { inspectArchive, type ArchiveInspection } from "../security/archive-inspection";

export type FileSecurityReport = {
  status: "passed";
  sha256: string;
  detectedType: string;
  checks: string[];
  archive?: Omit<ArchiveInspection, "entries">;
};

function extension(fileName: string) {
  return fileName.trim().toLowerCase().split(".").at(-1) ?? "";
}

function startsWith(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function validUtf8(bytes: Buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function assertContainerSignature(ext: string, bytes: Buffer) {
  if (ext === "pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Zawartość pliku nie jest prawidłowym PDF.");
  if (ext === "png" && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw new Error("Zawartość pliku nie jest prawidłowym PNG.");
  if (["jpg", "jpeg"].includes(ext) && !startsWith(bytes, [0xff, 0xd8, 0xff])) throw new Error("Zawartość pliku nie jest prawidłowym JPEG.");
  if (ext === "webp" && !(bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP")))) throw new Error("Zawartość pliku nie jest prawidłowym WebP.");
  if (["docx", "xlsx", "zip"].includes(ext) && !(
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  )) throw new Error("Zawartość pliku nie jest prawidłowym archiwum ZIP/Office.");
}

function detectedType(ext: string) {
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "zip") return "application/zip";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (["png", "webp"].includes(ext)) return `image/${ext}`;
  if (ext === "pdf") return "application/pdf";
  return "text/plain; charset=utf-8";
}

export function validateUploadedFileContent(fileName: string, bytes: Buffer): FileSecurityReport {
  if (!bytes.length) throw new Error("Przesłany plik jest pusty.");
  const ext = extension(fileName);
  const checks = ["size", "magic-bytes"];
  assertContainerSignature(ext, bytes);

  if (ext === "pdf") {
    const pdfTokens = bytes.toString("latin1");
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(pdfTokens)) {
      throw new Error("PDF zawiera aktywną akcję lub osadzony plik i wymaga osobnej kontroli.");
    }
    checks.push("pdf-active-content");
  }

  let archive: ArchiveInspection | undefined;
  if (["docx", "xlsx", "zip"].includes(ext)) {
    archive = inspectArchive(bytes);
    const entryNames = new Set(archive.entries.map((name) => name.toLowerCase()));
    if (ext === "docx" && (!entryNames.has("[content_types].xml") || !entryNames.has("word/document.xml"))) {
      throw new Error("Plik DOCX nie zawiera wymaganej struktury dokumentu Word.");
    }
    if (ext === "xlsx" && (!entryNames.has("[content_types].xml") || !entryNames.has("xl/workbook.xml"))) {
      throw new Error("Plik XLSX nie zawiera wymaganej struktury skoroszytu Excel.");
    }
    checks.push("archive-bounds", "archive-paths", "active-content");
  } else if (["csv", "xml", "txt", "json", "md"].includes(ext)) {
    if (!validUtf8(bytes)) throw new Error("Plik tekstowy nie jest prawidłowym UTF-8.");
    if (bytes.includes(0)) throw new Error("Plik tekstowy zawiera dane binarne.");
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (ext === "json") {
      try { JSON.parse(text); } catch { throw new Error("Plik JSON ma nieprawidłową składnię."); }
    }
    if (ext === "xml" && !text.startsWith("<")) throw new Error("Plik XML nie rozpoczyna się od znacznika.");
    checks.push("utf-8");
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    status: "passed",
    sha256,
    detectedType: detectedType(ext),
    checks,
    ...(archive ? { archive: { entryCount: archive.entryCount, compressedBytes: archive.compressedBytes, uncompressedBytes: archive.uncompressedBytes } } : {})
  };
}
