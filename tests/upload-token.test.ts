import { describe, expect, it } from "vitest";
import { createUploadToken, verifyUploadToken, type UploadIntent } from "../lib/r2/upload-token";

const intent: UploadIntent = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  documentId: "document-1",
  versionId: "version-1",
  objectKey: "workspaces/workspace-1/projects/project-1/documents/document-1/test.pdf",
  fileName: "test.pdf",
  mimeType: "application/pdf",
  fileSize: 123,
  expiresAt: Date.now() + 60_000
};

describe("upload token", () => {
  it("round-trips a signed upload intent", () => {
    const token = createUploadToken(intent, "test-secret");

    expect(verifyUploadToken(token, "test-secret").objectKey).toBe(intent.objectKey);
  });

  it("rejects a tampered token", () => {
    const token = `${createUploadToken(intent, "test-secret")}x`;

    expect(() => verifyUploadToken(token, "test-secret")).toThrow();
  });

  it("rejects an expired token", () => {
    const token = createUploadToken({ ...intent, expiresAt: Date.now() - 1000 }, "test-secret");

    expect(() => verifyUploadToken(token, "test-secret")).toThrow();
  });

  it("rejects a validly signed token with an invalid payload shape", () => {
    const malformed = createUploadToken({ ...intent, fileSize: Number.NaN }, "test-secret");

    expect(() => verifyUploadToken(malformed, "test-secret")).toThrow("nieprawidłową strukturę");
  });
});
