const baseUrl = String(process.env.E2E_BASE_URL ?? "").replace(/\/$/, "");
const expectedSha = String(process.env.GITHUB_SHA ?? "").trim().toLowerCase();
const timeoutMs = Number(process.env.E2E_DEPLOY_WAIT_MS ?? 10 * 60 * 1000);
const intervalMs = Number(process.env.E2E_DEPLOY_POLL_MS ?? 15 * 1000);

if (!baseUrl || !expectedSha) {
  console.error("Missing E2E_BASE_URL or GITHUB_SHA for production deployment verification.");
  process.exit(1);
}

const startedAt = Date.now();
let lastStatus = "no response";

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(`${baseUrl}/?e2e_release_check=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
      cache: "no-store",
      redirect: "follow"
    });
    const html = await response.text();
    const lower = html.toLowerCase();
    if (response.ok && (lower.includes(`commit ${expectedSha}`) || lower.includes(expectedSha))) {
      console.log(`Production is serving expected commit ${expectedSha.slice(0, 12)}.`);
      process.exit(0);
    }
    const deployed = lower.match(/commit ([0-9a-f]{7,40})/)?.[1] ?? "unknown";
    lastStatus = `HTTP ${response.status}; deployed=${deployed}`;
  } catch (error) {
    lastStatus = error instanceof Error ? error.message : String(error);
  }

  console.log(`Waiting for production commit ${expectedSha.slice(0, 12)} (${lastStatus})...`);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.error(`Production did not converge to ${expectedSha} within ${Math.round(timeoutMs / 1000)}s. Last status: ${lastStatus}`);
process.exit(1);
