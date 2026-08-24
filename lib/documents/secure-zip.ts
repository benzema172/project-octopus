import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const MAX_ZIP_ENTRIES = 100;
export const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
export const MAX_ZIP_COMPRESSION_RATIO = 150;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

type CentralEntry = {
  path: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

export type SecureZipEntry = {
  path: string;
  fileName: string;
  compressionMethod: number;
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: string;
  sha256: string;
  bytes: Buffer;
};

export type SecureZipResult = {
  entries: SecureZipEntry[];
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  ignoredEntries: string[];
  security: {
    encryptedEntries: 0;
    nestedArchivesAllowed: false;
    maxEntries: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
    maxCompressionRatio: number;
  };
};

function crcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

export function crc32ForBytes(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipError(message: string) {
  return new Error(`Niebezpieczna lub uszkodzona paczka ZIP: ${message}`);
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw zipError("brak katalogu centralnego.");
}

function safeEntryPath(rawPath: string) {
  const path = rawPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.length > 512 || path.includes("\0") || path.includes("\ufffd") || /[\u0000-\u001f]/.test(path)) throw zipError("nieprawidłowa nazwa pliku.");
  if (path.startsWith("/") || /^[a-z]:\//i.test(path)) throw zipError(`ścieżka absolutna „${rawPath}”.`);
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw zipError(`próba wyjścia poza paczkę w „${rawPath}”.`);
  return path;
}

function ignoredMetadata(path: string) {
  return path.startsWith("__MACOSX/") || path.endsWith("/.DS_Store") || path === ".DS_Store";
}

function readCentralEntries(bytes: Buffer) {
  const eocd = findEndOfCentralDirectory(bytes);
  const diskNumber = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw zipError("archiwum wieloczęściowe nie jest obsługiwane.");
  if (entryCount > MAX_ZIP_ENTRIES) throw zipError(`paczka zawiera więcej niż ${MAX_ZIP_ENTRIES} plików.`);
  if (eocd + 22 + commentLength !== bytes.length) throw zipError("nieprawidłowa długość komentarza końcowego.");
  if (centralOffset + centralSize !== eocd || centralOffset >= bytes.length) throw zipError("katalog centralny wykracza poza plik.");

  const entries: CentralEntry[] = [];
  const paths = new Set<string>();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw zipError("nieprawidłowy wpis katalogu centralnego.");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc32 = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw zipError("ucięta nazwa lub metadane wpisu.");
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) throw zipError("ZIP64 nie jest obsługiwany w paczkach aplikacji.");
    const rawPath = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const directory = rawPath.endsWith("/");
    const path = safeEntryPath(directory ? rawPath.slice(0, -1) : rawPath);
    if (!directory) {
      if ((flags & 0x1) !== 0) throw zipError(`zaszyfrowany plik „${rawPath}”.`);
      if (![0, 8].includes(method)) throw zipError(`nieobsługiwana metoda kompresji ${method} w „${rawPath}”.`);
      if (paths.has(path.toLocaleLowerCase("pl"))) throw zipError(`zduplikowana ścieżka „${rawPath}”.`);
      paths.add(path.toLocaleLowerCase("pl"));
      entries.push({ path, flags, method, crc32, compressedSize, uncompressedSize, localOffset });
    }
    offset = next;
  }
  return entries;
}

function extractEntry(archive: Buffer, entry: CentralEntry) {
  if (entry.localOffset + 30 > archive.length || archive.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) {
    throw zipError(`brak nagłówka lokalnego „${entry.path}”.`);
  }
  const nameLength = archive.readUInt16LE(entry.localOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localOffset + 28);
  const localFlags = archive.readUInt16LE(entry.localOffset + 6);
  const localMethod = archive.readUInt16LE(entry.localOffset + 8);
  const localPath = archive.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength).toString("utf8");
  if ((localFlags & 0x1) !== 0 || localFlags !== entry.flags) throw zipError(`niespójne flagi „${entry.path}”.`);
  if (localMethod !== entry.method || safeEntryPath(localPath) !== entry.path) throw zipError(`niespójny nagłówek lokalny „${entry.path}”.`);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataOffset < 0 || dataEnd > archive.length) throw zipError(`treść „${entry.path}” wykracza poza paczkę.`);
  if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw zipError(`„${entry.path}” przekracza limit 50 MB po rozpakowaniu.`);
  if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) throw zipError(`niespójny rozmiar pliku „${entry.path}”.`);
  if (entry.uncompressedSize > 1024 * 1024 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > MAX_ZIP_COMPRESSION_RATIO) {
    throw zipError(`„${entry.path}” ma podejrzany współczynnik kompresji.`);
  }

  const compressed = archive.subarray(dataOffset, dataEnd);
  let output: Buffer;
  try {
    output = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_ZIP_ENTRY_BYTES, entry.uncompressedSize + 1) });
  } catch {
    throw zipError(`nie udało się bezpiecznie rozpakować „${entry.path}”.`);
  }
  if (output.length !== entry.uncompressedSize) throw zipError(`rozmiar „${entry.path}” nie zgadza się z manifestem.`);
  if (crc32ForBytes(output) !== entry.crc32) throw zipError(`suma CRC „${entry.path}” jest nieprawidłowa.`);
  return output;
}

export function parseSecureZip(bytes: Buffer): SecureZipResult {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw zipError("plik nie ma sygnatury ZIP.");
  const centralEntries = readCentralEntries(bytes);
  const totalDeclared = centralEntries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (totalDeclared > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) throw zipError("łączny rozmiar po rozpakowaniu przekracza 250 MB.");

  const ignoredEntries: string[] = [];
  const entries: SecureZipEntry[] = [];
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (const entry of centralEntries) {
    if (ignoredMetadata(entry.path)) {
      ignoredEntries.push(entry.path);
      continue;
    }
    const output = extractEntry(bytes, entry);
    totalCompressedBytes += entry.compressedSize;
    totalUncompressedBytes += output.length;
    entries.push({
      path: entry.path,
      fileName: entry.path.split("/").at(-1) ?? entry.path,
      compressionMethod: entry.method,
      compressedBytes: entry.compressedSize,
      uncompressedBytes: output.length,
      crc32: entry.crc32.toString(16).padStart(8, "0"),
      sha256: createHash("sha256").update(output).digest("hex"),
      bytes: output
    });
  }
  if (entries.length === 0) throw zipError("paczka nie zawiera dokumentów.");
  return {
    entries,
    totalCompressedBytes,
    totalUncompressedBytes,
    ignoredEntries,
    security: {
      encryptedEntries: 0,
      nestedArchivesAllowed: false,
      maxEntries: MAX_ZIP_ENTRIES,
      maxEntryBytes: MAX_ZIP_ENTRY_BYTES,
      maxTotalBytes: MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
      maxCompressionRatio: MAX_ZIP_COMPRESSION_RATIO
    }
  };
}
