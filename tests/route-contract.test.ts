import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pathFromRoot = (path: string) => resolve(root, path);

const companyRoutes = [
  "app/workspace/companies/[workspaceId]/page.tsx",
  "app/workspace/companies/[workspaceId]/investments/page.tsx",
  "app/workspace/companies/[workspaceId]/documents/page.tsx",
  "app/workspace/companies/[workspaceId]/ai-center/page.tsx",
  "app/workspace/companies/[workspaceId]/ai-inbox/page.tsx",
  "app/workspace/companies/[workspaceId]/reports/page.tsx",
  "app/workspace/companies/[workspaceId]/settings/page.tsx",
  "app/workspace/companies/[workspaceId]/[section]/page.tsx",
  "app/workspace/companies/[workspaceId]/error.tsx"
];

const projectRoutes = [
  "app/workspace/projects/[projectId]/page.tsx",
  "app/workspace/projects/[projectId]/control/page.tsx",
  "app/workspace/projects/[projectId]/data/page.tsx",
  "app/workspace/projects/[projectId]/documentation/page.tsx",
  "app/workspace/projects/[projectId]/cost-estimate/page.tsx",
  "app/workspace/projects/[projectId]/brain/page.tsx",
  "app/workspace/projects/[projectId]/requests/page.tsx",
  "app/workspace/projects/[projectId]/protocols/page.tsx",
  "app/workspace/projects/[projectId]/schedule/page.tsx",
  "app/workspace/projects/[projectId]/progress/page.tsx",
  "app/workspace/projects/[projectId]/finance/page.tsx",
  "app/workspace/projects/[projectId]/team/page.tsx",
  "app/workspace/projects/[projectId]/warehouse/page.tsx",
  "app/workspace/projects/[projectId]/reports/page.tsx",
  "app/workspace/projects/[projectId]/site/page.tsx",
  "app/workspace/projects/[projectId]/closeout/page.tsx",
  "app/workspace/projects/[projectId]/outputs/page.tsx",
  "app/workspace/projects/[projectId]/error.tsx"
];

const legacyRedirects: Array<[string, string]> = [
  ["app/workspace/projects/[projectId]/estimate/page.tsx", "/cost-estimate"],
  ["app/workspace/projects/[projectId]/applications/page.tsx", "/requests"],
  ["app/workspace/documents/page.tsx", "redirectToCurrentCompany(\"documents\")"],
  ["app/workspace/ai-inbox/page.tsx", "redirectToCurrentCompany(\"ai-inbox\")"],
  ["app/workspace/reports/page.tsx", "redirectToCurrentCompany(\"reports\")"],
  ["app/workspace/settings/page.tsx", "redirectToCurrentCompany(\"settings\")"],
  ["app/workspace/finance/page.tsx", "redirectToCurrentCompany(\"finances\")"]
];

describe("canonical workspace routes", () => {
  it.each(companyRoutes)("keeps company route %s", (path) => {
    expect(existsSync(pathFromRoot(path)), `${path} should exist`).toBe(true);
  });

  it.each(projectRoutes)("keeps project route %s", (path) => {
    expect(existsSync(pathFromRoot(path)), `${path} should exist`).toBe(true);
  });
});

describe("legacy route redirects", () => {
  it.each(legacyRedirects)("redirects %s to canonical destination", (path, expected) => {
    const fullPath = pathFromRoot(path);
    expect(existsSync(fullPath), `${path} should exist`).toBe(true);
    expect(readFileSync(fullPath, "utf8")).toContain(expected);
  });
});
