import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(file:string)=>readFileSync(file,"utf8");

describe("Compact company settings",()=>{
 it("groups settings into short accessible collapsible sections",()=>{
  const page=read("app/workspace/companies/[workspaceId]/settings/page.tsx");
  for(const id of ["company-profile","settings-ai","security-automation","settings-infrastructure","settings-automation"])
   expect(page).toContain('id="'+id+'"');
  expect((page.match(/co-settings-compact__group/g)??[]).length).toBe(5);
  expect(page).toContain('co-settings-compact__overview');
  expect(page).not.toContain('<section className="co-settings-cards">');
 });
 it("preserves financial access, role editing, integrations and company profile actions",()=>{
  const page=read("app/workspace/companies/[workspaceId]/settings/page.tsx");
  expect(page).toContain('updateCompanyAction.bind(null, workspace.id)');
  expect(page).toContain('disabled={!schemaReady || !canWrite}');
  expect(page).toContain('canWrite={canAdminAi}');
  expect(page).toContain('<RoleGrantForm');
  expect(page).toContain('<MultiAiProviderSettings');
  expect(page).toContain('<SettingsAutomationConsole');
  expect(page).toContain('canWrite={canWrite && executionReady}');
  expect(page).toContain('getMultiAiProviderStatus(workspace.id)');
 });
 it("keeps automation and notifications available without permanent long forms",()=>{
  const console=read("components/settings/settings-automation-console.tsx");
  expect(console).toContain('settings-automation-console__group');
  expect(console).toContain('Dodaj integrację lub regułę');
  expect(console).toContain('Historia alertów');
  expect(console).toContain('onSubmit={submitIntegration}');
  expect(console).toContain('onSubmit={submitRule}');
  expect(console).toContain('run("run_alert_scan"');
  expect(console).toContain('onClick={() => run("notification_read"');
 });
 it("keeps mobile layout and keyboard focus available",()=>{
  const css=read("app/globals.css");
  expect(css).toContain('.co-settings-compact__group>summary:focus-visible');
  expect(css).toContain('@media(max-width:660px)');
  expect(css).toContain('.settings-automation-console__group');
 });
});
