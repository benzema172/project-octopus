import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const staleRoot = /^(AUDIT_|IMPLEMENTATION_|INVESTMENT_AUTOPILOT_|RELEASE_).*\.md$/i;
const retiredMarkers = [
  "@/components/company/warehouse-command-center",
  "@/components/company/fleet-workspace-400",
  "@/lib/data/fleet-connected-400"
];

const rootEntries = await readdir(root, { withFileTypes: true });
const stale = rootEntries.filter((entry) => entry.isFile() && staleRoot.test(entry.name)).map((entry) => entry.name);
if (stale.length) {
  throw new Error(`Historyczne pliki release/audit wróciły do root repo: ${stale.join(", ")}`);
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".next", "node_modules"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) result.push(full);
  }
  return result;
}

const sourceFiles = await walk(root);
const retiredHits = [];
for (const file of sourceFiles) {
  const relative = path.relative(root, file);
  if (relative === "scripts/check-repo-hygiene.mjs") continue;
  const content = await readFile(file, "utf8");
  for (const marker of retiredMarkers) {
    if (content.includes(marker)) retiredHits.push(`${path.relative(root, file)} -> ${marker}`);
  }
}
if (retiredHits.length) {
  throw new Error(`Kod nadal odwołuje się do wycofanych warstw:\n${retiredHits.join("\n")}`);
}

const rootLayout = await readFile(path.join(root, "app", "layout.tsx"), "utf8");
for (const css of ["warehouse-kpi-compact.css", "warehouse-navigation-refinement.css"]) {
  if (rootLayout.includes(css)) throw new Error(`Styl modułu Magazyn nie może być globalnie importowany z app/layout.tsx: ${css}`);
}

console.log("Repo hygiene OK: brak historycznych plików root, martwych importów i globalnych styli Magazynu.");
