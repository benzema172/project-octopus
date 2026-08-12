import "server-only";

import { inflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("Nie znaleziono katalogu ZIP w pliku Office.");
}

function listEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("Nieprawidłowa struktura katalogu ZIP.");
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

export function readZipFiles(buffer: Buffer) {
  const result = new Map<string, Buffer>();

  for (const entry of listEntries(buffer)) {
    if (entry.name.endsWith("/")) continue;
    const offset = entry.localHeaderOffset;

    if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
      throw new Error(`Nieprawidłowy nagłówek ZIP dla ${entry.name}.`);
    }

    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    let data: Buffer;

    if (entry.compressionMethod === 0) {
      data = Buffer.from(compressed);
    } else if (entry.compressionMethod === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`Nieobsługiwana metoda kompresji ZIP (${entry.compressionMethod}) dla ${entry.name}.`);
    }

    if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
      throw new Error(`Nieprawidłowy rozmiar po rozpakowaniu ${entry.name}.`);
    }

    result.set(entry.name, data);
  }

  return result;
}

export function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
