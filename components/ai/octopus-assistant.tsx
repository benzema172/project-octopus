"use client";

import { FormEvent, useState } from "react";
import { ArrowUp, CheckCircle2, Database, ShieldCheck, X } from "lucide-react";

type AssistantSource = { ref?: string; title?: string; category?: string; locator?: Record<string, unknown> | null };
type AssistantAction = { tool?: string; result?: unknown };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: AssistantSource[];
  actions?: AssistantAction[];
  autonomyLevel?: number;
  traceId?: string;
};

type OctopusAssistantProps = { workspaceId: string; companyName: string };

function OctopusMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="co-octopus-mark">
      <defs><linearGradient id="octopus-ai-gradient" x1="4" y1="12" x2="60" y2="54" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ff2d86" /><stop offset="0.38" stopColor="#8a2be2" /><stop offset="0.72" stopColor="#1e5bff" /><stop offset="1" stopColor="#00cfc2" /></linearGradient></defs>
      <path fill="url(#octopus-ai-gradient)" d="M32 8c-11.6 0-20 8.6-20 20.1 0 5.1 1.7 9.3 4.8 12.3-1.2 5-4.1 7.4-7.1 6.8-1.6-.3-2.8.9-2.5 2.4.7 3.6 4.2 5.7 8.1 5.2 3.8-.5 6.1-3.2 7.4-6.1.2 5.2 2 8.2 5.2 8.2 2.6 0 4.1-2.1 4.2-5.4.8 4 2.7 6.2 5.5 6 2.9-.2 4.4-2.9 4-7 1.8 3.2 4.4 5.2 7.3 4.4 3.5-1 5-4.3 3.5-7.6 2.3 1.2 4.9 1.2 7.1-.1 1.4-.8 1.5-2.8.1-3.7-3-2-5.5-4.7-7-8.1A19.3 19.3 0 0 0 52 28.1C52 16.6 43.6 8 32 8Z" />
      <circle cx="25" cy="27" r="2.3" fill="white" /><circle cx="39" cy="27" r="2.3" fill="white" /><path d="M26.5 35c3.6 2.7 7.4 2.7 11 0" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

function locatorLabel(source: AssistantSource) {
  const locator = source.locator ?? {};
  const from = locator.pageFrom ?? locator.page ?? locator.page_from;
  const to = locator.pageTo ?? locator.page_to;
  const section = typeof locator.section === "string" ? locator.section : "";
  if (from && to && from !== to) return `str. ${String(from)}–${String(to)}`;
  if (from) return `str. ${String(from)}`;
  return section || "źródło Brain";
}

export function OctopusAssistant({ workspaceId, companyName }: OctopusAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: `Jestem OctopusAI 2.0 — Autonomous Company Brain. Pracuję w kontekście firmy ${companyName}. Potrafię wyszukiwać źródła, analizować moduły i wykonywać bezpieczne, odwracalne działania zgodnie z poziomem autonomii.` }]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    const history = messages.slice(-12).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput(""); setSending(true); setError(null);
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, message, history }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "OctopusAI nie odpowiedział.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: payload.answer,
        sources: Array.isArray(payload.sources) ? payload.sources : [],
        actions: Array.isArray(payload.actions) ? payload.actions : [],
        autonomyLevel: Number.isFinite(Number(payload.autonomyLevel)) ? Number(payload.autonomyLevel) : undefined,
        traceId: typeof payload.traceId === "string" ? payload.traceId : undefined
      }]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Nie udało się połączyć z OctopusAI."); }
    finally { setSending(false); }
  }

  return (
    <div className={`co-ai ${open ? "is-open" : ""}`}>
      {open ? (
        <section className="co-ai-panel" aria-label="OctopusAI 2.0">
          <header className="co-ai-panel__head">
            <div className="co-ai-title"><OctopusMark size={34} /><div><strong>OctopusAI 2.0</strong><span>{companyName}</span></div></div>
            <button type="button" className="co-icon-button" onClick={() => setOpen(false)} aria-label="Zamknij OctopusAI"><X size={18} aria-hidden="true" /></button>
          </header>

          <div className="co-ai-messages">
            {messages.map((message, index) => (
              <div className={`co-ai-message co-ai-message--${message.role}`} key={`${message.role}-${index}`}>
                <div>{message.content}</div>
                {message.role === "assistant" && (message.sources?.length || message.actions?.length || message.autonomyLevel != null) ? (
                  <div style={{ marginTop: 10, display: "grid", gap: 7, fontSize: 11, opacity: 0.78 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {message.autonomyLevel != null ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><ShieldCheck size={12} /> autonomia L{message.autonomyLevel}</span> : null}
                      {message.sources?.length ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Database size={12} /> źródła {message.sources.length}</span> : null}
                      {message.actions?.length ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><CheckCircle2 size={12} /> działania {message.actions.length}</span> : null}
                    </div>
                    {message.sources?.length ? (
                      <div style={{ display: "grid", gap: 3 }}>
                        {message.sources.slice(0, 5).map((source, sourceIndex) => <span key={`${source.ref ?? sourceIndex}-${source.title ?? "source"}`}><strong>{source.ref ?? `S${sourceIndex + 1}`}</strong> · {source.title ?? "Źródło"} · {locatorLabel(source)}</span>)}
                      </div>
                    ) : null}
                    {message.traceId ? <span title={message.traceId}>ślad audytowy: {message.traceId.slice(0, 8)}</span> : null}
                  </div>
                ) : null}
              </div>
            ))}
            {sending ? <div className="co-ai-message co-ai-message--assistant co-ai-message--thinking">Planuję, sprawdzam źródła i wykonuję bezpieczne kroki…</div> : null}
          </div>

          {error ? <p className="co-ai-error">{error}</p> : null}
          <form className="co-ai-input" onSubmit={submit}>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={2} placeholder="Zapytaj lub zleć zadanie OctopusAI…" maxLength={8000} />
            <button type="submit" aria-label="Wyślij pytanie" disabled={!input.trim() || sending}><ArrowUp size={18} aria-hidden="true" /></button>
          </form>
        </section>
      ) : null}
      <button type="button" className="co-ai-trigger" onClick={() => setOpen((value) => !value)} aria-label={open ? "Zamknij OctopusAI" : "Otwórz OctopusAI"}><OctopusMark /><span>OctopusAI</span></button>
    </div>
  );
}
