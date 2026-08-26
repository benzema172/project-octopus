import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Investment Wrzutnia drag, drop and folder picker", () => {
  it("mounts the ProjectIntake used by the investment header", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const slot = read("components/projects/project-intake-slot.tsx");

    expect(layout).toContain("<ProjectIntakeSlot projectId={project.id} />");
    expect(slot).toContain("project-intake-pipeline");
    expect(slot).toContain("module.ProjectIntake");
  });

  it("recognizes files, ZIPs and recursively dropped or selected folders", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("webkitGetAsEntry");
    expect(intake).toContain("candidatesFromDataTransfer");
    expect(intake).toContain("candidatesFromEntry");
    expect(intake).toContain("readDirectoryEntries");
    expect(intake).toContain("Upuść dokumenty albo cały folder");
    expect(intake).toContain("MAX_FOLDER_FILES = 1000");
    expect(intake).toContain("Wybierz pliki");
    expect(intake).toContain("Wybierz folder");
    expect(intake).toContain("webkitdirectory");
  });

  it("starts processing automatically and reports real byte upload progress", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("queue.current.push(...accepted)");
    expect(intake).toContain("void drainQueue()");
    expect(intake).toContain("new XMLHttpRequest()");
    expect(intake).toContain("xhr.upload.onprogress");
    expect(intake).toContain("uploadedBytes");
    expect(intake).toContain("uploadedFiles");
    expect(intake).toContain("formatBytes(progress.uploadedBytes)");
    expect(intake).toContain("/api/brain/process-document");
    expect(intake).not.toContain("Wyślij i analizuj");
  });

  it("does not render a manual successful-document worklist and lists only skipped or problematic files with reasons", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).not.toContain('className="pw-intake-list"');
    expect(intake).toContain("pw-intake-skipped");
    expect(intake).toContain("Pominięte / wymagające uwagi");
    expect(intake).toContain("issue.reason");
    expect(intake).toContain("validateUploadFile");
    expect(intake).toContain("Plik systemowy systemu operacyjnego");
    expect(intake).toContain("Duplikat — ten sam plik");
  });

  it("keeps folder context for every accepted investment document without manual package metadata", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("relativePath: string");
    expect(intake).toContain("folderPathForCandidate");
    expect(intake).toContain("packageLabel: folderPathForCandidate");
    expect(intake).toContain('parts.includes("__MACOSX")');
    expect(intake).toContain('new Set([".DS_Store", "Thumbs.db", "desktop.ini"])');
    expect(intake).not.toContain("Nazwa paczki");
    expect(intake).not.toContain("Oznaczenie rewizji");
  });
});
