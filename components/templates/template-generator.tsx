"use client";

import { FormEvent, useState, useTransition } from "react";
import { FileOutput, LoaderCircle } from "lucide-react";

type Option = { id: string; label: string };

export function TemplateGenerator({ templates, projects }: { templates: Option[]; projects: Option[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ message: string; previewUrl?: string } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setResult(null);
    startTransition(async () => {
      const response = await fetch("/api/templates/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateVersionId: form.get("templateVersionId"), projectId: form.get("projectId"), documentType: form.get("documentType") }) });
      const payload = await response.json() as { error?: string; previewUrl?: string; warnings?: string[] };
      setResult({ message: response.ok ? `Szkic utworzony${payload.warnings?.length ? ` · ${payload.warnings.length} ostrzeżeń` : ""}.` : payload.error ?? "Nie udało się utworzyć szkicu.", previewUrl: payload.previewUrl });
    });
  }
  return <form className="template-generator" onSubmit={submit}><div className="form-row"><label>Zatwierdzony wzór<select name="templateVersionId" required defaultValue=""><option value="" disabled>Wybierz wzór</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Inwestycja<select name="projectId" required defaultValue=""><option value="" disabled>Wybierz inwestycję</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div><label>Rodzaj dokumentu<select name="documentType" defaultValue="material_application"><option value="material_application">Wniosek materiałowy</option><option value="protocol">Protokół</option><option value="schedule">Harmonogram</option><option value="progress_report">Protokół przerobu</option><option value="report">Raport</option></select></label><button type="submit" className="primary-button" disabled={pending || !templates.length || !projects.length}>{pending ? <LoaderCircle className="spin" size={16} /> : <FileOutput size={16} />}Utwórz kontrolowany szkic</button>{result ? <p className="action-message">{result.message}{result.previewUrl ? <> <a href={result.previewUrl} target="_blank" rel="noreferrer">Otwórz podgląd / zapisz PDF</a></> : null}</p> : null}</form>;
}
