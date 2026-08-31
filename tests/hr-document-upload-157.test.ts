import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry HR document upload", () => {
  const uploader = readFileSync("components/company/hr/hr-document-upload-157.tsx", "utf8");
  const workspace = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-document-upload-157.module.css", "utf8");

  it("mounts a real dropzone inside the current HR document panel", () => {
    expect(workspace).toContain("<HrDocumentUpload157");
    expect(workspace).toContain('documentsVisible = activeTab === "documents"');
    expect(uploader).toContain("Wrzuć tutaj dokumenty kadrowe");
    expect(uploader).toContain('data-hr-functional-upload="1"');
    expect(uploader).toContain("Przeciągnij pliki tutaj lub kliknij, aby wybrać");
    expect(css).toContain(".dropzone");
  });

  it("uploads HR files through the existing R2 and Brain pipeline", () => {
    expect(uploader).toContain('fetch("/api/storage/upload-url"');
    expect(uploader).toContain('category: "hr"');
    expect(uploader).toContain("categoryLocked: true");
    expect(uploader).toContain('fetch("/api/storage/complete"');
    expect(uploader).toContain('fetch("/api/brain/process"');
  });

  it("attempts employee matching after AI analysis and keeps a library fallback", () => {
    expect(uploader).toContain('action: "employee_document_autolink"');
    expect(uploader).toContain("Otwórz pełną bibliotekę dokumentów");
    expect(uploader).toContain("SUPPORTED_UPLOAD_ACCEPT");
    expect(uploader).toContain("validateUploadFile");
  });
});
