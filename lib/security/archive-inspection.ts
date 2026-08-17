export const MAX_ARCHIVE_ENTRIES = 2_000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
export const MAX_ARCHIVE_COMPRESSION_RATIO = 200;

type ArchiveEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
  localOffset: number;
};

export type ArchiveInspection = {
  entryCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  entries: string[];
};

const BLOCKED_ENTRY_EXTENSIONS = new Set([
  "apk", "app", "bat", "cmd", "com", "dll", "dmg", "exe", "hta", "jar",
  "js", "jse", "lnk", "msi", "msp", "ps1", "scr", "sh", "vbe", "vbs", "wsf"
]);

function findEndOfCentralDirectory(buffer: Buffer) {
  if (buffer.length < 22) throw new Error("Archiwum ZIP jest niekompletne.");
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Nie znaleziono katalogu centralnego ZIP.");
}

function normalizeEntryName(value: string) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error("Archiwum zawiera nieprawidłową ścieżkę.");
  }
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Archiwum zawiera próbę wyjścia poza katalog: ${normalized}.`);
  }
  return normalized;
}

function readEntries(buffer: Buffer): ArchiveEntry[] {
  const endOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  let offset = buffer.readUInt32LE(endOffset + 16);
  if (totalEntries > MAX_ARCHIVE_ENTRIES) throw new Error(`Archiwum przekracza limit ${MAX_ARCHIVE_ENTRIES} wpisów.`);
  if (offset + centralDirectorySize > buffer.length) throw new Error("Katalog centralny ZIP wykracza poza plik.");

  const entries: ArchiveEntry[] = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Nieprawidłowy wpis katalogu ZIP.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > buffer.length) throw new Error("Nazwa wpisu ZIP wykracza poza plik.");
    const name = normalizeEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) throw new Error("Archiwum ZIP64 nie jest obsługiwane.");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Brak lokalnego nagłówka wpisu: ${name}.`);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const localName = normalizeEntryName(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8"));
    if (dataStart + compressedSize > buffer.length || localName !== name || localMethod !== method || Boolean(localFlags & 0x1) !== Boolean(flags & 0x1)) {
      throw new Error(`Nagłówki wpisu ZIP są niespójne: ${name}.`);
    }
    entries.push({ name, method, compressedSize, uncompressedSize, encrypted: Boolean(flags & 0x1), localOffset });
    offset = nextOffset;
  }
  return entries;
}

export function inspectArchive(buffer: Buffer): ArchiveInspection {
  const entries = readEntries(buffer);
  let compressedBytes = 0;
  let uncompressedBytes = 0;

  for (const entry of entries) {
    if (entry.encrypted) throw new Error(`Archiwum zawiera zaszyfrowany wpis: ${entry.name}.`);
    if (![0, 8].includes(entry.method)) throw new Error(`Archiwum używa nieobsługiwanej metody kompresji: ${entry.name}.`);
    compressedBytes += entry.compressedSize;
    uncompressedBytes += entry.uncompressedSize;
    if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error("Rozpakowana zawartość archiwum przekracza limit 250 MB.");
    }
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_ARCHIVE_COMPRESSION_RATIO) {
      throw new Error(`Podejrzany współczynnik kompresji wpisu: ${entry.name}.`);
    }
    const lowerName = entry.name.toLowerCase();
    const entryExtension = lowerName.split(".").at(-1) ?? "";
    if (BLOCKED_ENTRY_EXTENSIONS.has(entryExtension) || lowerName.endsWith("vbaproject.bin")) {
      throw new Error(`Archiwum zawiera aktywny lub wykonywalny plik: ${entry.name}.`);
    }
  }

  return {
    entryCount: entries.length,
    compressedBytes,
    uncompressedBytes,
    entries: entries.map((entry) => entry.name)
  };
}
