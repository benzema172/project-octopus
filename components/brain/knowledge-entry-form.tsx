"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Save } from "lucide-react";

export function KnowledgeEntryForm({ workspaceId, projects }: { workspaceId: string; projects: Array<{ id: string; name: string }> }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form.entries()), workspaceId }) });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Wpis zapisano i wysłano do zatwierdzenia." : payload.error ?? "Nie udało się zapisać wpisu.");
      if (response.ok) { formElement.reset(); router.refresh(); }
    });
  }
  return <form className="knowledge-entry-form" onSubmit={submit}><div className="form-row"><label>Rodzaj<select name="entryType" defaultValue="lesson_learned"><option value="lesson_learned">Lekcja z inwestycji</option><option value="solution">Sprawdzone rozwiązanie</option><option value="productivity">Wydajność / norma własna</option><option value="risk">Ryzyko i reakcja</option></select></label><label>Inwestycja źródłowa<select name="sourceProjectId" defaultValue=""><option value="">Wiedza ogólna firmy</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><label>Tytuł<input name="title" required /></label><label>Podsumowanie<textarea name="summary" rows={3} required /></label><div className="form-row"><label>Problem<textarea name="problem" rows={3} /></label><label>Rozwiązanie<textarea name="solution" rows={3} /></label></div><label>Tagi<input name="tags" placeholder="kanalizacja, próba szczelności, odbiór" /></label><button type="submit" className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Zapisz do kontroli</button>{message ? <p className="action-message">{message}</p> : null}</form>;
}
