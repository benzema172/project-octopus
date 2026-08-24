"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, FileCheck2, LoaderCircle, Plus, ShieldCheck, TriangleAlert, Users } from "lucide-react";

type Requirement = { id: string; protocol_type: string; title: string; status: string };
type DocumentOption = { id: string; name: string };
type Protocol = {
  id: string; protocol_requirement_id: string | null; protocol_type: string; title: string; protocol_date: string | null;
  scope: string | null; location: string | null; test_medium: string | null; test_pressure: number | null; pressure_unit: string | null;
  test_duration_minutes: number | null; measurement_device: string | null; result: string | null; remarks: string | null; status: string;
  participants: Array<{ name: string; role: string | null; company: string | null; signed: boolean }>;
  evidence: Array<{ id: string; document_id: string | null; label: string; evidence_type: string }>;
};

type Props = { projectId: string; canWrite: boolean; requirements: Requirement[]; documents: DocumentOption[]; protocols: Protocol[] };

function parseParticipants(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name = "", role = "", company = "", signed = ""] = line.split("|").map((part) => part.trim());
    return { name, role, company, signed: ["tak", "yes", "1", "podpisano"].includes(signed.toLowerCase()) };
  }).filter((row) => row.name);
}

export function ProtocolsProPanel({ projectId, canWrite, requirements, documents, protocols }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState("");
  const requirement = useMemo(() => requirements.find((item) => item.id === selectedRequirement), [requirements, selectedRequirement]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const evidence = data.getAll("evidenceDocumentIds").map((id) => {
      const document = documents.find((item) => item.id === String(id));
      return { documentId: String(id), type: "document", label: document?.name ?? "Dowód dokumentowy" };
    });
    const body = {
      projectId, action: "save", protocolRequirementId: String(data.get("protocolRequirementId") ?? "") || null,
      protocolType: String(data.get("protocolType") ?? ""), title: String(data.get("title") ?? ""), protocolDate: String(data.get("protocolDate") ?? "") || null,
      performedAt: String(data.get("performedAt") ?? "") || null, scope: String(data.get("scope") ?? ""), location: String(data.get("location") ?? ""),
      testMedium: String(data.get("testMedium") ?? ""), testPressure: String(data.get("testPressure") ?? ""), pressureUnit: String(data.get("pressureUnit") ?? ""),
      testDurationMinutes: String(data.get("testDurationMinutes") ?? ""), measurementDevice: String(data.get("measurementDevice") ?? ""),
      result: String(data.get("result") ?? ""), remarks: String(data.get("remarks") ?? ""), participants: parseParticipants(String(data.get("participants") ?? "")), evidence
    };
    setMessage(null); setError(null);
    startTransition(async () => {
      const response = await fetch("/api/projects/protocols", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Nie udało się zapisać protokołu."); return; }
      form.reset(); setSelectedRequirement(""); setMessage("Protokół zapisany. Jeśli ma wynik, trafił do weryfikacji."); router.refresh();
    });
  }

  function review(protocolId: string, action: "approve" | "reject") {
    setMessage(null); setError(null);
    startTransition(async () => {
      const response = await fetch("/api/projects/protocols", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, protocolId, action }) });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) { setError(result.error ?? "Nie udało się zatwierdzić protokołu."); return; }
      setMessage(action === "approve" ? "Protokół zatwierdzony i wymagania odbiorowe zaktualizowane." : "Protokół odrzucony."); router.refresh();
    });
  }

  return <section className="project-operation-card pw-submodule-register">
    <div className="project-operation-card__heading"><div><p className="eyebrow">Rejestr PRO</p><h3>Protokoły z danymi wykonawczymi</h3><p>Wyniki, osoby, dowody i decyzje.</p></div><ClipboardCheck size={22} /></div>
    {canWrite ? <details className="pw-submodule-tool pw-submodule-tool--nested"><summary><Plus size={16}/>Dodaj wynik próby lub odbioru</summary><form className="project-operation-form" onSubmit={save}><div>
      <label><span>Wymaganie z dokumentacji</span><select name="protocolRequirementId" value={selectedRequirement} onChange={(event) => setSelectedRequirement(event.target.value)}><option value="">Bez powiązania / ręczny protokół</option>{requirements.filter((item) => item.status !== "fulfilled").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>Rodzaj protokołu</span><input name="protocolType" required defaultValue={requirement?.protocol_type ?? ""} key={`type-${selectedRequirement}`} placeholder="np. pressure_test" /></label>
      <label><span>Nazwa</span><input name="title" required defaultValue={requirement?.title ?? ""} key={`title-${selectedRequirement}`} /></label>
      <label><span>Data protokołu</span><input name="protocolDate" type="date" /></label>
      <label><span>Moment wykonania</span><input name="performedAt" type="datetime-local" /></label>
      <label><span>Zakres</span><textarea name="scope" rows={2} placeholder="Odcinek, instalacja, zakres robót" /></label>
      <label><span>Lokalizacja</span><input name="location" placeholder="budynek / kondygnacja / pomieszczenie" /></label>
      <label><span>Medium próby</span><input name="testMedium" placeholder="woda / powietrze / inne" /></label>
      <label><span>Ciśnienie</span><input name="testPressure" type="number" step="any" /></label>
      <label><span>Jednostka</span><input name="pressureUnit" placeholder="bar / MPa" /></label>
      <label><span>Czas próby [min]</span><input name="testDurationMinutes" type="number" step="1" min="0" /></label>
      <label><span>Urządzenie pomiarowe</span><input name="measurementDevice" placeholder="typ, producent, nr przyrządu" /></label>
      <label><span>Rzeczywisty wynik</span><textarea name="result" rows={3} placeholder="np. wynik pozytywny, brak spadku ciśnienia..." /></label>
      <label><span>Uwagi</span><textarea name="remarks" rows={2} /></label>
      <label><span>Uczestnicy</span><textarea name="participants" rows={4} placeholder={"Jan Kowalski | Kierownik robót | Firma X | podpisano\nAnna Nowak | Inspektor | Inwestor | podpisano"} /></label>
      <label><span>Dowody / załączniki</span><select name="evidenceDocumentIds" multiple size={Math.min(6, Math.max(3, documents.length))}>{documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
    </div><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Zapisz rzeczywisty protokół</button></form></details> : <p className="project-operation-card__notice"><TriangleAlert size={17} />Tryb tylko do odczytu.</p>}
    {message ? <p className="project-operation-card__success"><CheckCircle2 size={16} />{message}</p> : null}{error ? <p className="project-operation-card__error"><TriangleAlert size={16} />{error}</p> : null}
    <div className="project-live-records"><div className="project-live-records__heading"><div><p className="eyebrow">Dane na żywo</p><h3>Wyniki prób i odbiorów</h3></div><strong>{protocols.length}</strong></div>
      {protocols.map((protocol) => <article className="project-live-record" key={protocol.id}><div><strong>{protocol.title}</strong><p>{protocol.protocol_type} · {protocol.protocol_date ?? "bez daty"} · {protocol.location ?? "bez lokalizacji"}</p><small>{protocol.result ?? "Brak wyniku"}</small></div><div><span><Users size={14} /> {protocol.participants.length}</span><span><FileCheck2 size={14} /> {protocol.evidence.length}</span><span>{protocol.status}</span></div>{canWrite && ["draft", "ai_ready", "in_review"].includes(protocol.status) ? <div><button type="button" className="primary-button" disabled={pending} onClick={() => review(protocol.id, "approve")}><ShieldCheck size={15} />Akceptuj</button><button type="button" className="secondary-button" disabled={pending} onClick={() => review(protocol.id, "reject")}>Odrzuć</button></div> : null}</article>)}
      {!protocols.length ? <p className="empty-copy">Brak rzeczywistych protokołów. Dodaj pierwszy wynik z budowy.</p> : null}
    </div>
  </section>;
}
