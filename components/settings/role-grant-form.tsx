"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldX } from "lucide-react";

type Grant = { id: string; userId: string; domain: string; accessLevel: string; projectId: string | null };

const DOMAIN_LABELS: Record<string, string> = {
  investments: "Inwestycje",
  finance: "Finanse",
  hr: "Kadry",
  warehouse: "Magazyn",
  fleet: "Flota",
  templates: "Wzory",
  reports: "Raporty",
  settings: "Ustawienia"
};

const LEVEL_LABELS: Record<string, string> = { read: "Odczyt", write: "Zapis", approve: "Zatwierdzanie", admin: "Administracja" };

export function RoleGrantForm({ workspaceId, members, projects, grants }: { workspaceId: string; members: Array<{ userId: string; role: string }>; projects: Array<{ id: string; name: string }>; grants: Grant[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const response = await fetch("/api/settings/role-grants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form.entries()), workspaceId }) });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Rola została zapisana." : payload.error ?? "Nie udało się zapisać roli.");
      if (response.ok) router.refresh();
    });
  }

  function revoke(grantId: string) {
    startTransition(async () => {
      const response = await fetch("/api/settings/role-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", grantId, workspaceId })
      });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Rola została odebrana." : payload.error ?? "Nie udało się odebrać roli.");
      if (response.ok) router.refresh();
    });
  }

  return <div className="template-generator"><form className="template-generator" onSubmit={submit}><div className="form-row"><label>Użytkownik<select name="userId" required>{members.map((member) => <option key={member.userId} value={member.userId}>{member.userId.slice(0, 8)}… · {member.role}</option>)}</select></label><label>Domena<select name="domain" defaultValue="investments"><option value="investments">Inwestycje</option><option value="finance">Finanse</option><option value="hr">Kadry</option><option value="warehouse">Magazyn</option><option value="fleet">Flota</option><option value="templates">Wzory</option><option value="reports">Raporty</option><option value="settings">Ustawienia</option></select></label></div><div className="form-row"><label>Poziom<select name="accessLevel" defaultValue="read"><option value="read">Odczyt</option><option value="write">Zapis</option><option value="approve">Zatwierdzanie</option><option value="admin">Administracja</option></select></label><label>Zakres inwestycji<select name="projectId" defaultValue=""><option value="">Cała firma</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><button type="submit" className="primary-button" disabled={pending || !members.length}>{pending ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}Nadaj / zaktualizuj rolę</button></form>{grants.length ? <div className="live-record-list">{grants.map((grant) => <article key={grant.id}><KeyRound size={18} /><div><strong>{DOMAIN_LABELS[grant.domain] ?? grant.domain} · {LEVEL_LABELS[grant.accessLevel] ?? grant.accessLevel}</strong><small>{grant.userId.slice(0, 8)}… · {grant.projectId ? projects.find((project) => project.id === grant.projectId)?.name ?? "Wybrana inwestycja" : "Cała firma"}</small></div><button type="button" className="secondary-button" disabled={pending} onClick={() => revoke(grant.id)}><ShieldX size={15} />Odbierz</button></article>)}</div> : <p className="action-message">Brak aktywnych ról domenowych. Członkowie korzystają wyłącznie z podstawowej roli firmowej.</p>}{message ? <p className="action-message">{message}</p> : null}</div>;
}
