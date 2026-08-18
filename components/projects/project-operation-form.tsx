"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Plus, TriangleAlert } from "lucide-react";

export type ProjectOperationMode = "requirement" | "protocol" | "schedule" | "progress_period" | "progress_entry" | "assignment" | "budget" | "reservation" | "change_order";
export type ProjectOperationOption = { value: string; label: string };

type Props = {
  projectId: string;
  mode: ProjectOperationMode;
  title: string;
  description: string;
  canWrite: boolean;
  primaryOptions?: ProjectOperationOption[];
  secondaryOptions?: ProjectOperationOption[];
};

type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: ProjectOperationOption[];
};

const actions: Record<ProjectOperationMode, string> = {
  requirement: "project_requirement_create",
  protocol: "protocol_requirement_create",
  schedule: "schedule_activity_create",
  progress_period: "progress_period_create",
  progress_entry: "progress_entry_create",
  assignment: "assignment_create",
  budget: "budget_create",
  reservation: "reservation_create",
  change_order: "change_order_create"
};

function fieldsFor(mode: ProjectOperationMode, primary: ProjectOperationOption[], secondary: ProjectOperationOption[]): Field[] {
  if (mode === "requirement") return [
    { name: "requirementType", label: "Rodzaj", type: "select", options: [{ value: "material_application", label: "Wniosek materiałowy" }, { value: "technical", label: "Wymaganie techniczne" }, { value: "quality", label: "Wymaganie jakościowe" }] },
    { name: "title", label: "Tytuł wymagania", required: true },
    { name: "description", label: "Opis i kryteria", type: "textarea" }
  ];
  if (mode === "protocol") return [
    { name: "protocolType", label: "Rodzaj", type: "select", options: [{ value: "pressure_test", label: "Próba ciśnieniowa" }, { value: "tightness", label: "Próba szczelności" }, { value: "hidden_works", label: "Roboty zanikowe" }, { value: "partial_acceptance", label: "Odbiór częściowy" }, { value: "measurement", label: "Pomiary" }] },
    { name: "title", label: "Nazwa wymaganego protokołu", required: true }
  ];
  if (mode === "schedule") return [
    { name: "code", label: "Kod WBS / zadania" }, { name: "title", label: "Nazwa zadania", required: true },
    { name: "plannedStart", label: "Planowany start", type: "date" }, { name: "plannedFinish", label: "Planowany koniec", type: "date" },
    { name: "critical", label: "Ścieżka krytyczna", type: "select", options: [{ value: "false", label: "Nie" }, { value: "true", label: "Tak" }] }
  ];
  if (mode === "progress_period") return [
    { name: "periodStart", label: "Okres od", type: "date", required: true }, { name: "periodEnd", label: "Okres do", type: "date", required: true }
  ];
  if (mode === "progress_entry") return [
    { name: "progressPeriodId", label: "Okres przerobowy", type: "select", options: primary, required: true },
    { name: "boqItemId", label: "Pozycja BOQ", type: "select", options: secondary, required: true },
    { name: "quantityExecuted", label: "Ilość wykonana", type: "number", required: true }, { name: "quantityAccepted", label: "Ilość odebrana", type: "number", required: true }
  ];
  if (mode === "assignment") return [
    { name: "employeeId", label: "Pracownik", type: "select", options: primary, required: true }, { name: "role", label: "Rola na inwestycji", required: true },
    { name: "dateFrom", label: "Od", type: "date" }, { name: "dateTo", label: "Do", type: "date" }, { name: "allocationPercent", label: "Zaangażowanie %", type: "number", placeholder: "100" }
  ];
  if (mode === "budget") return [
    { name: "name", label: "Nazwa wersji budżetu", required: true, placeholder: "Budżet bazowy" }, { name: "totalRevenue", label: "Przychód planowany", type: "number", required: true }, { name: "totalCost", label: "Koszt planowany", type: "number", required: true }
  ];
  if (mode === "reservation") return [
    { name: "warehouseId", label: "Magazyn", type: "select", options: primary, required: true }, { name: "stockItemId", label: "Materiał / kartoteka", type: "select", options: secondary, required: true },
    { name: "quantity", label: "Ilość", type: "number", required: true }, { name: "requiredAt", label: "Potrzebne na", type: "date" }
  ];
  return [
    { name: "number", label: "Numer zmiany" }, { name: "title", label: "Tytuł zmiany", required: true }, { name: "description", label: "Opis i uzasadnienie", type: "textarea" },
    { name: "valueChange", label: "Zmiana wartości PLN", type: "number" }, { name: "daysChange", label: "Zmiana terminu (dni)", type: "number" }
  ];
}

export function ProjectOperationForm({ projectId, mode, title, description, canWrite, primaryOptions = [], secondaryOptions = [] }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsFor(mode, primaryOptions, secondaryOptions);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setMessage(null); setError(null);
    startTransition(async () => {
      const endpoint = mode === "reservation" ? "/api/projects/reservations" : "/api/projects/operations";
      const payload = mode === "reservation" ? { projectId, ...values } : { projectId, action: actions[mode], ...values };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Nie udało się zapisać rekordu."); return; }
      form.reset(); setMessage("Zapisano. Dane są już widoczne w rejestrze poniżej."); router.refresh();
    });
  }

  return <section className="project-operation-card"><div className="project-operation-card__heading"><div><p className="eyebrow">Działanie operacyjne</p><h3>{title}</h3><p>{description}</p></div><Plus size={21} /></div>{canWrite ? <form onSubmit={submit} className="project-operation-form"><div>{fields.map((field) => <label key={field.name}><span>{field.label}</span>{field.type === "textarea" ? <textarea name={field.name} placeholder={field.placeholder} required={field.required} rows={3} /> : field.type === "select" ? <select name={field.name} required={field.required} defaultValue=""><option value="">Wybierz</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={field.name} type={field.type ?? "text"} inputMode={field.type === "number" ? "decimal" : undefined} step={field.type === "number" ? "any" : undefined} placeholder={field.placeholder} required={field.required} />}</label>)}</div><button className="primary-button" disabled={pending || ((mode === "progress_entry" || mode === "assignment" || mode === "reservation") && !primaryOptions.length)}>{pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Zapisz rekord</button></form> : <p className="project-operation-card__notice"><TriangleAlert size={17} />Masz dostęp tylko do odczytu. Poproś administratora o uprawnienie zapisu.</p>}{message ? <p className="project-operation-card__success"><CheckCircle2 size={16} />{message}</p> : null}{error ? <p className="project-operation-card__error"><TriangleAlert size={16} />{error}</p> : null}</section>;
}
