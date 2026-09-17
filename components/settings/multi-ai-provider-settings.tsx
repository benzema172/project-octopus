"use client";

import { useState } from "react";
import { CheckCircle2, Cloud, Cpu, LoaderCircle, ShieldCheck } from "lucide-react";

type ProviderStatus = {
  groq: { configured: boolean; model: string };
  cloudflare: { configured: boolean; accountConfigured: boolean; model: string };
};

type Props = {
  workspaceId: string;
  canWrite: boolean;
  initialStatus: ProviderStatus;
};

export function MultiAiProviderSettings({ workspaceId, canWrite, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"groq" | "cloudflare" | null>(null);
  const [message, setMessage] = useState("");

  async function save(provider: "groq" | "cloudflare", form: HTMLFormElement) {
    setBusy(provider);
    setMessage("");
    const data = new FormData(form);
    const apiKey = String(data.get("apiKey") ?? "").trim();
    const accountId = String(data.get("accountId") ?? "").trim();
    try {
      const response = await fetch("/api/company/multi-ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, provider, apiKey, accountId: accountId || undefined })
      });
      const body = await response.json() as { error?: string; status?: ProviderStatus; test?: { latencyMs?: number } };
      if (!response.ok || !body.status) throw new Error(body.error || "Nie udało się zapisać providera.");
      setStatus(body.status);
      form.reset();
      setMessage(`${provider === "groq" ? "Groq" : "Cloudflare Workers AI"} działa poprawnie${body.test?.latencyMs ? ` · ${body.test.latencyMs} ms` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Błąd konfiguracji AI.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="co-section" id="multi-ai-providers">
      <div className="co-section-heading">
        <div>
          <p className="co-kicker">Octopus Multi-AI Core</p>
          <h2>Dodatkowi dostawcy AI</h2>
          <p>Klucze są testowane przed zapisem i przechowywane w Supabase Vault. Po zapisaniu nie wracają do przeglądarki.</p>
        </div>
        <span className="status-chip status-chip--positive"><ShieldCheck size={14} /> Vault</span>
      </div>

      {message ? <div className="co-schema-warning"><CheckCircle2 size={16} /> {message}</div> : null}

      <div className="control-dashboard-grid">
        <article className="module-panel">
          <div className="module-panel__heading"><Cpu size={19} /><div><p className="eyebrow">Second opinion</p><h2>Groq · GPT-OSS 120B</h2></div></div>
          <p><strong>{status.groq.configured ? "Aktywny" : "Nie skonfigurowano"}</strong> · {status.groq.model}</p>
          <form onSubmit={(event) => { event.preventDefault(); void save("groq", event.currentTarget); }} className="co-settings-form">
            <label className="co-field co-field--wide"><span>Groq API Key</span><input name="apiKey" type="password" autoComplete="off" placeholder={status.groq.configured ? "Wprowadź tylko, jeśli chcesz zmienić klucz" : "gsk_…"} required /></label>
            <div className="co-settings-form__actions"><button className="co-primary-button" type="submit" disabled={!canWrite || busy !== null}>{busy === "groq" ? <LoaderCircle size={15} /> : null} Testuj i zapisz</button></div>
          </form>
        </article>

        <article className="module-panel">
          <div className="module-panel__heading"><Cloud size={19} /><div><p className="eyebrow">Independent fallback</p><h2>Cloudflare Workers AI</h2></div></div>
          <p><strong>{status.cloudflare.configured ? "Aktywny" : "Nie skonfigurowano"}</strong> · {status.cloudflare.model}</p>
          <form onSubmit={(event) => { event.preventDefault(); void save("cloudflare", event.currentTarget); }} className="co-settings-form">
            <label className="co-field co-field--wide"><span>Workers AI API Token</span><input name="apiKey" type="password" autoComplete="off" placeholder="Token z uprawnieniem Workers AI" required /></label>
            <label className="co-field co-field--wide"><span>Cloudflare Account ID</span><input name="accountId" autoComplete="off" placeholder="Opcjonalnie — Octopus spróbuje użyć Account ID z R2" /></label>
            <div className="co-settings-form__actions"><button className="co-primary-button" type="submit" disabled={!canWrite || busy !== null}>{busy === "cloudflare" ? <LoaderCircle size={15} /> : null} Testuj i zapisz</button></div>
          </form>
        </article>
      </div>
    </section>
  );
}
