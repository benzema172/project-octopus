const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function starts(bytes: Uint8Array, signature: Uint8Array) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function isZip(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]);
}

function looksText(bytes: Uint8Array) {
  if (!bytes.length) return true;
  let control = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / bytes.length < 0.02;
}

export function validateFileSignature(fileName: string, mimeType: string, bytes: Uint8Array): string | null {
  const extension = fileName.toLowerCase().split(".").at(-1) ?? "";
  if (extension === "pdf") return starts(bytes, Buffer.from("%PDF-")) ? null : "Plik .pdf nie ma prawidłowej sygnatury PDF.";
  if (extension === "png") return starts(bytes, PNG) ? null : "Plik .png nie ma prawidłowej sygnatury PNG.";
  if (["jpg", "jpeg"].includes(extension)) return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? null : "Plik obrazu nie ma prawidłowej sygnatury JPEG.";
  if (extension === "webp") return bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP" ? null : "Plik .webp nie ma prawidłowej sygnatury WEBP.";
  if (["docx", "xlsx", "zip"].includes(extension)) return isZip(bytes) ? null : `Plik .${extension} nie ma prawidłowego kontenera ZIP/OpenXML.`;
  if (["doc", "xls"].includes(extension)) return starts(bytes, OLE) ? null : `Plik .${extension} nie ma prawidłowej sygnatury OLE.`;
  if (["txt", "csv", "xml", "json", "md"].includes(extension) || mimeType.toLowerCase().startsWith("text/")) return looksText(bytes) ? null : "Plik tekstowy zawiera binarną zawartość niezgodną z deklarowanym formatem.";
  return null;
}
