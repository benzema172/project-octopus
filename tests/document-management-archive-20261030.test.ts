import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(path:string)=>readFileSync(path,"utf8");
const api=read("app/api/storage/document-metadata/route.ts");
const manager=read("components/documents/document-management-controls.tsx");
const archive=read("components/documents/document-central-archive.tsx");
const page=read("app/workspace/companies/[workspaceId]/documents/page.tsx");
const state=read("app/api/storage/document-state/route.ts");

describe("Simple document archive management",()=>{
  it("authorizes document rename against its actual workspace and domain",()=>{
    expect(api).toContain("await getRequestUser(request)");
    expect(api).toContain("getWorkspaceForUser(user,body.workspaceId!)");
    expect(api).toContain('domain:domainForDocumentCategory(source.category)');
    expect(api).toContain('level:"write"');
    expect(api).toContain('.eq("workspace_id",workspace.id)');
    expect(api).toContain('.eq("updated_at",source.updated_at)');
    expect(api).toContain('.is("deleted_at",null)');
    expect(api).toContain('event_type:"document.archive_name_changed"');
  });
  it("changes display name only and never changes original R2 or posted accounting",()=>{
    expect(api).toContain("name,title:name");
    expect(api).not.toContain("delete()");
    expect(api).not.toContain("document_versions");
    expect(api).not.toContain("invoices");
    expect(api).not.toContain("stock_movements");
  });
  it("preserves immutable versions and SHA integrity when replacing",()=>{
    expect(manager).toContain("crypto.subtle.digest");
    expect(manager).toContain('method:"PUT"');
    expect(manager).toContain('fetch("/api/storage/complete"');
    expect(manager).toContain('releaseType:"revision"');
    expect(manager).toContain("documentId,fileName:file.name");
    expect(manager).toContain("Nowa wersja");
  });
  it("requires explicit confirmation before moving a file to recoverable trash",()=>{
    expect(manager).toContain("if(!confirmTrash||busy)return");
    expect(manager).toContain('state:"trashed"');
    expect(manager).toContain("Tak, przenieś do kosza");
    expect(state).toContain('deleted_at: trashed ? new Date().toISOString() : null');
    expect(archive).toContain('state: "active"');
  });
  it("makes edit controls visible on the main All tab and selected files",()=>{
    expect(archive).toContain("tab === \"all\" ? <div");
    expect(archive).toContain("<DocumentManagementControls");
    expect(page).toContain('const searchQuery = activeTab === "trash" ? ""');
    expect(archive).toContain("Wszystkie");
  });
});
