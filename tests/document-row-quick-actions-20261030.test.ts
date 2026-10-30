import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const source=(path:string)=>readFileSync(path,"utf8");
const archive=source("components/documents/document-central-archive.tsx");
const controls=source("components/documents/document-management-controls.tsx");
const styles=source("components/documents/document-management-controls.module.css");
const api=source("app/api/storage/document-metadata/route.ts");
const trash=source("app/api/storage/document-state/route.ts");

describe("Inline document archive quick actions",()=>{
  it("shows direct Edit/Delete controls in each document list row without expanding details",()=>{
    expect(archive).toContain("<DocumentManagementControls\n                      key=");
    expect(archive).toContain("                      compact");
    expect(archive).toContain("styles.rowInline");
    expect(archive).toContain("onClick={() => setSelectedId(isSelected ? null : document.id)}");
    expect(archive).toContain("onArchived={() => setSelectedId(null)}");
  });
  it("keeps the clickable file separate from its management buttons (no nested buttons)",()=>{
    const start=archive.indexOf("return (\n                    <DocumentManagementControls");
    const end=archive.indexOf("</DocumentManagementControls>",start);
    const row=archive.slice(start,end);
    expect(start).toBeGreaterThan(0);
    expect(row).toContain("</button>");
    expect(row).not.toContain("onClick={() => void archive()");
    expect(controls).toContain("{children}\n    <div className={styles.actions}>");
  });
  it("exposes compact labels while retaining full details editor and reversible deletion",()=>{
    expect(controls).toContain('compact ? "Edytuj" : "Edytuj nazwę"');
    expect(controls).toContain('compact ? "Usuń" : "Do kosza"');
    expect(controls).toContain("if(!confirmTrash||busy)return");
    expect(controls).toContain('state:"trashed"');
    expect(controls).toContain("Tak, przenieś do kosza");
    expect(styles).toContain(".compact>.form,.compact>.confirm");
  });
  it("reuses company-scoped safe APIs and retention checks",()=>{
    expect(api).toContain('domain:domainForDocumentCategory(source.category)');
    expect(api).toContain('level:"write"');
    expect(trash).toContain('hasDomainAccess(');
    expect(trash).toContain('documentStateErrorStatus');
  });
});
