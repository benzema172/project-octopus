import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Investment Wrzutnia drag and drop", () => {
  it("mounts the ProjectIntake used by the investment header", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const slot = read("components/projects/project-intake-slot.tsx");

    expect(layout).toContain("<ProjectIntakeSlot projectId={project.id} />");
    expect(slot).toContain("project-intake-pipeline");
    expect(slot).toContain("module.ProjectIntake");
  });

  it("recognizes files, ZIPs and recursively dropped folders without picker buttons", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("webkitGetAsEntry");
    expect(intake).toContain("candidatesFromDataTransfer");
    expect(intake).toContain("candidatesFromEntry");
    expect(intake).toContain("readDirectoryEntries");
    expect(intake).toContain("Upuść tutaj dokumenty, ZIP lub cały folder");
    expect(intake).toContain("MAX_FOLDER_FILES = 1000");
    expect(intake).not.toContain(">Wybierz pliki<");
    expect(intake).not.toContain("Wybierz folder");
    expect(intake).not.toContain("pw-intake-picker-actions");
  });

  it("starts processing automatically and reports real byte upload progress", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("queue.current.push(...accepted)");
    expect(intake).toContain("void drainQueue()");
    expect(intake).toContain("new XMLHttpRequest()");
    expect(intake).toContain("xhr.upload.onprogress");
    expect(intake).toContain("uploadedBytes");
    expect(intake).toContain("uploadedFiles");
    expect(intake).toContain("remainingPercent");
    expect(intake).toContain("formatBytes(remainingBytes)");
    expect(intake).not.toContain("Wyślij i analizuj");
  });

  it("does not render the successful-document list and lists only skipped or problematic files with reasons", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).not.toContain('className="pw-intake-list"');
    expect(intake).toContain("pw-intake-skipped");
    expect(intake).toContain("Pominięte / wymagające uwagi");
    expect(intake).toContain("issue.reason");
    expect(intake).toContain("validateUploadFile");
    expect(intake).toContain("Plik systemowy systemu operacyjnego");
    expect(intake).toContain("Duplikat — ten sam plik");
  });

  it("keeps folder context for every accepted investment document", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("relativePath: string");
    expect(intake).toContain("folderPathForCandidate");
    expect(intake).toContain("packageLabelForItem");
    expect(intake).toContain("packageLabel: packageLabelForItem(packageLabel, item)");
    expect(intake).toContain('parts.includes("__MACOSX")');
    expect(intake).toContain('new Set([".DS_Store", "Thumbs.db", "desktop.ini"])');
  });
});
