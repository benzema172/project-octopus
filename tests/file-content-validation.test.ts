import { describe, expect, it } from "vitest";
import { validateUploadedFileContent } from "../lib/r2/file-content-validation";

function makeZip(entries: Array<{ name: string; content?: string }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content ?? "");
    const local = Buffer.alloc(30 + name.length + content.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    content.copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

describe("uploaded file content validation", () => {
  it("accepts a real PDF signature and calculates the server checksum", () => {
    const report = validateUploadedFileContent("projekt.pdf", Buffer.from("%PDF-1.7\n%%EOF"));
    expect(report.status).toBe("passed");
    expect(report.detectedType).toBe("application/pdf");
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a file whose extension does not match its bytes", () => {
    expect(() => validateUploadedFileContent("faktura.pdf", Buffer.from("<html>phishing</html>"))).toThrow("prawidłowym PDF");
    expect(() => validateUploadedFileContent("zdjecie.png", Buffer.from("not an image"))).toThrow("prawidłowym PNG");
  });

  it("quarantines active actions embedded in PDF", () => {
    expect(() => validateUploadedFileContent("instrukcja.pdf", Buffer.from("%PDF-1.7\n/JavaScript (alert)\n%%EOF"))).toThrow("aktywną akcję");
  });

  it("requires the actual Office container structure", () => {
    const docx = makeZip([
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/document.xml", content: "<w:document/>" }
    ]);
    const report = validateUploadedFileContent("umowa.docx", docx);
    expect(report.archive?.entryCount).toBe(2);
    expect(() => validateUploadedFileContent("kosztorys.xlsx", docx)).toThrow("struktury skoroszytu");
  });

  it("quarantines traversal paths and active content inside archives", () => {
    expect(() => validateUploadedFileContent("paczka.zip", makeZip([{ name: "../evil.txt" }]))).toThrow("wyjścia poza katalog");
    expect(() => validateUploadedFileContent("paczka.zip", makeZip([{ name: "uruchom.exe" }]))).toThrow("wykonywalny");
  });

  it("rejects binary or malformed text payloads", () => {
    expect(() => validateUploadedFileContent("dane.txt", Buffer.from([0x41, 0x00, 0x42]))).toThrow("dane binarne");
    expect(() => validateUploadedFileContent("dane.json", Buffer.from("{broken"))).toThrow("JSON");
  });
});
