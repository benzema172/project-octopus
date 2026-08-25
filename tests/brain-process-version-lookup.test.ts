import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/brain/process/route.ts", "utf8");

test("brain/process resolves the version and workspace document without an embedded PostgREST join", () => {
  assert.match(route, /\.from\("document_versions"\)/);
  assert.match(route, /\.select\("document_id,project_id"\)/);
  assert.match(route, /versionError/);

  assert.match(route, /\.from\("documents"\)/);
  assert.match(route, /\.eq\("id", version\.document_id\)/);
  assert.match(route, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(route, /documentError/);

  assert.doesNotMatch(route, /documents!inner\(workspace_id,category\)/);
});

test("brain/process distinguishes database failures from a genuine missing version", () => {
  assert.match(route, /\[brain\/process\] version lookup failed/);
  assert.match(route, /Nie udało się odczytać wersji dokumentu\./);
  assert.match(route, /Nie znaleziono wersji dokumentu\./);
  assert.match(route, /\[brain\/process\] document lookup failed/);
});
