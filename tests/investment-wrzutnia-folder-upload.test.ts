import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Investment Wrzutnia folder upload", () => {
  it("mounts the ProjectIntake used by the investment header", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const slot = read("components/projects/project-intake-slot.tsx");

    expect(layout).toContain("<ProjectIntakeSlot projectId={project.id} />");
    expect(slot).toContain("project-intake-pipeline");
    expect(slot).toContain("module.ProjectIntake");
  });

  it("offers a real folder picker and recursively reads dropped folders", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("folderInput");
    expect(intake).toContain('ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", "")');
    expect(intake).toContain('setAttribute("directory", "")');
    expect(intake).toContain("webkitGetAsEntry");
    expect(intake).toContain("candidatesFromDataTransfer");
    expect(intake).toContain("candidatesFromEntry");
    expect(intake).toContain("readDirectoryEntries");
    expect(intake).toContain("Wybierz folder");
    expect(intake).toContain("Przeciągnij pliki lub cały folder");
    expect(intake).toContain("MAX_FOLDER_FILES = 1000");
  });

  it("keeps folder context for every uploaded investment document", () => {
    const intake = read("components/projects/project-intake-pipeline.tsx");

    expect(intake).toContain("webkitRelativePath");
    expect(intake).toContain("relativePath: string");
    expect(intake).toContain("folderPathForCandidate");
    expect(intake).toContain("packageLabelForItem");
    expect(intake).toContain("packageLabel: packageLabelForItem(packageLabel, item)");
    expect(intake).toContain('parts.includes("__MACOSX")');
    expect(intake).toContain('new Set([".DS_Store", "Thumbs.db", "desktop.ini"])');
  });
});
