// ChromeDriver runs on the CI runner. Only the disposable guest session is copied into Chrome.
const driver = "http://127.0.0.1:9515";

async function command(method, path, body) {
  const response = await fetch(driver + path, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw Error("ChromeDriver " + path.split("/").at(-1) + ": " + (value?.error || response.status));
  return value;
}

export async function verifyConstructionPanels(base, projectId, cookies) {
  const { sessionId } = await command("POST", "/session", { capabilities: { alwaysMatch: {
    browserName: "chrome", "goog:loggingPrefs": { browser: "ALL" },
    "goog:chromeOptions": { args: ["--headless=new", "--disable-dev-shm-usage", "--no-sandbox"] }
  } } });
  const session = "/session/" + sessionId;
  const visit = url => command("POST", session + "/url", { url });
  const execute = (script, ...args) => command("POST", session + "/execute/sync", { script, args });
  const panels = [
    ["schedule", "Zadania z przedmiaru i warunki odbioru"],
    ["requests", "Karty wyrobów i pozycje kosztorysu"],
    ["protocols", "Pomiary, kryteria i uwagi do odcinków"]
  ];
  try {
    const origin = new URL(base).origin;
    await visit(origin + "/");
    if (new URL(await command("GET", session + "/url")).origin !== origin) throw Error("Unexpected login origin");
    for (const [name, value] of cookies) {
      await command("POST", session + "/cookie", { cookie: { name, value, path: "/", secure: true } });
    }
    for (const [path, title] of panels) {
      await visit(origin + "/workspace/projects/" + projectId + "/" + path);
      const opened = await execute(`
        const label = Array.from(document.querySelectorAll("summary")).find(el => el.textContent.trim() === arguments[0]);
        if (!label) return false;
        label.click();
        return true;
      `, title);
      if (!opened) throw Error("Missing browser panel: " + path);
      let ready = false;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const state = await execute(`
          const label = Array.from(document.querySelectorAll("summary")).find(el => el.textContent.startsWith(arguments[0]));
          const panel = label?.closest("details");
          if (panel?.querySelector('[role="alert"]')) return "error";
          return panel?.open && panel.querySelector("ul li") ? "ready" : "loading";
        `, title);
        if (state === "error") throw Error("Source loading failed in browser: " + path);
        if (state === "ready") { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) {
        const detail = await execute(`
          const label = Array.from(document.querySelectorAll("summary")).find(el => el.textContent.startsWith(arguments[0]));
          const panel = label?.closest("details");
          return {open:panel?.open, count:panel?.querySelectorAll("li").length, heading:label?.textContent,
            loading:Boolean(panel?.querySelector('[role="status"]')), empty:panel?.textContent.includes('Brak danych do porównania')};
        `, title);
        throw Error("No source rows appeared in browser: " + path + " " + JSON.stringify(detail));
      }
    }
    const logs = await command("POST", session + "/se/log", { type: "browser" });
    const errors = logs.filter(entry => entry.level === "SEVERE");
    if (errors.length) throw Error("Production browser errors: " + errors.length + " (" + errors.map(entry => {
      const rawUrl = entry.message?.match(/https?:\/\/[^\s]+/)?.[0];
      let route = "";
      if (rawUrl) {
        try { const url = new URL(rawUrl); route = url.origin + url.pathname; } catch { /* log only valid, query-free URLs */ }
      }
      const reason = entry.message?.match(/status of \d{3}|net::ERR_[A-Z_]+|Uncaught [A-Za-z]+/i)?.[0] || "";
      return [entry.source || "browser", route, reason].filter(Boolean).join(" ");
    }).join(", ") + ")");
    console.log("Chrome verified 3 expanded source panels with live rows; zero severe browser errors.");
  } finally {
    await command("DELETE", session);
  }
}
