import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readText = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const vercel = readJson("vercel.json");
const deploymentPolicy = vercel.git?.deploymentEnabled;

assert.deepEqual(
  vercel.regions,
  ["dub1"],
  "Vercel Functions must stay in dub1 to keep server-side work close to the Supabase eu-west-1 database."
);
assert.equal(
  deploymentPolicy?.["**"],
  false,
  "Automatic Vercel deployments must be disabled by default for non-production branches."
);
assert.equal(
  deploymentPolicy?.main,
  true,
  "The main branch must remain the only automatic Vercel deployment path."
);
assert.ok(
  vercel.crons?.some((job) => job.path === "/api/cron/operations" && job.schedule === "15 4 * * *"),
  "The operations cron contract must stay intact."
);

const ci = readText(".github/workflows/ci.yml");
assert.match(ci, /node-version:\s*24\b/, "CI Node version must match Vercel Node 24.x.");
assert.match(ci, /cancel-in-progress:\s*true\b/, "CI must cancel superseded runs.");
assert.match(ci, /permissions:\s*[\s\S]*?contents:\s*read\b/, "CI should run with read-only repository contents permission.");
assert.match(ci, /npm ci --no-audit --no-fund/, "CI dependency install must stay deterministic and lean.");
assert.match(ci, /npm run check:stability/, "CI must execute the Stability & Performance Core contract.");

const packageJson = readJson("package.json");
assert.equal(
  packageJson.scripts?.["check:stability"],
  "node scripts/check-stability-core.mjs",
  "package.json must expose the stability contract."
);

console.log("Stability & Performance Core contract: OK");
