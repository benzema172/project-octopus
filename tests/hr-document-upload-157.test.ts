import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry Core 3.0 — dokumenty i Wrzutnia", () => {
  const uploader = readFileSync("components/company/hr/hr-document-upload-157.tsx", "utf8");
  const documents = readFileSync("components/company/hr/hr-documents-compact-161.tsx", "utf8");
  const shell = readFileSync("components/company/hr/hr-workspace-core-300.tsx", "utf8");
  const intelligence = readFileSync("lib/hr/document-intelligence.ts", "utf8");
  const css = readFileSync("components/company/hr/hr-document-upload-157.module.css", "utf8");

  it("mounts the real HR dropzone in the current Core 3.0 documents section", () => {
    expect(shell).toContain('import("./hr-documents-compact-161")');
    expect(documents).toContain("<HrDocumentUpload157");
    expect(uploader).toContain("Wrzuć dokumenty kadrowe");
    expect(uploader).toContain('data-hr-functional-upload="1"');
    expect(uploader).toContain("Przeciągnij pliki tutaj lub kliknij, aby wybrać");
    expect(css).toContain(".dropzone");
  });

  it("uploads through the existing R2 and Brain pipeline", () => {
    expect(uploader).toContain('fetch("/api/storage/upload-url"');
    expect(uploader).toContain('category: "hr"');
    expect(uploader).toContain("categoryLocked: true");
    expect(uploader).toContain('fetch("/api/storage/complete"');
    expect(uploader).toContain('fetch("/api/brain/process"');
    expect(uploader).toContain("SUPPORTED_UPLOAD_ACCEPT");
    expect(uploader).toContain("validateUploadFile");
  });

  it("uses Brain intake to match employees and feed formal HR registers", () => {
    expect(uploader).toContain("hrIntake");
    expect(uploader).toContain("complianceRecords");
    expect(uploader).toContain("leaveRequest");
    expect(intelligence).toContain("employee_document_auto_assigned");
    expect(intelligence).toContain("createComplianceFromDocument");
    expect(uploader).toContain("Otwórz pełną bibliotekę dokumentów");
  });
});
