"use client";

import type { FormEvent, ReactNode } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Search } from "lucide-react";
import { ServerPagination } from "@/components/system/server-pagination";

export type Row = Record<string, unknown>;
export type PageMeta = { page: number; pageSize: number; total: number };
export type Data = Record<string, unknown> & { page?: PageMeta; summary?: Row };
export type Option = [string, string];
export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "email" | "select";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  rows?: Row[];
  labelKey?: string;
  options?: Option[];
};
export type FormSpec = { title: string; entity: string; success: string; fields: Field[]; wide?: boolean };
export type MetricSpec = { label: string; value: ReactNode; caption: string };
export type ColumnSpec = { label: string; value: (row: Row) => ReactNode };

type Props = {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  pathname: string;
  query: string;
  metrics: MetricSpec[];
  forms: FormSpec[];
  rows: Row[];
  columns: ColumnSpec[];
  emptyLabel: string;
  tableTitle: string;
  children?: ReactNode;
};

function optionLabel(row: Row, key = "name") {
  return String(row[key] ?? row.name ?? row.title ?? row.registration_number ?? row.employee_number ?? row.id ?? "—");
}

function RecordForm({ form, pending, onSubmit }: { form: FormSpec; pending: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className={`ops-form-card${form.wide ? " ops-form-card--wide" : ""}`} onSubmit={onSubmit}>
    <h3>{form.title}</h3>
    <div className="ops-form-fields">{form.fields.map((field) => <label key={field.name}><span>{field.label}</span>{field.rows || field.options || field.type === "select" ? <select name={field.name} required={field.required} defaultValue={field.defaultValue ?? ""}><option value="">{field.placeholder ?? (field.required ? "Wybierz" : "—")}</option>{field.options?.map(([value,label]) => <option key={value} value={value}>{label}</option>)}{field.rows?.map((row) => <option key={String(row.id)} value={String(row.id)}>{optionLabel(row, field.labelKey)}</option>)}</select> : <input name={field.name} type={field.type ?? "text"} required={field.required} placeholder={field.placeholder} defaultValue={field.defaultValue} step={field.type === "number" ? "any" : undefined} />}</label>)}</div>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Zapisywanie…" : "Zapisz"}</button>
  </form>;
}

export function CompanyModuleShell({ workspaceId, data, canWrite, pathname, query, metrics, forms, rows, columns, emptyLabel, tableTitle, children }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const page = data.page ?? { page: 1, pageSize: Math.max(rows.length, 1), total: rows.length };

  const submit = (entity: string, success: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setMessage(null); setError(null);
    startTransition(async () => {
      const response = await fetch("/api/company/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, entity, payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Nie udało się zapisać danych."); return; }
      form.reset(); setMessage(success); router.refresh();
    });
  };

  return <div className="ops-workspace ops-workspace--paged">
    <form className="ops-search" method="get" action={pathname}><Search size={17}/><input name="q" defaultValue={query} placeholder="Szukaj w module…"/><button className="secondary-button" type="submit">Szukaj</button>{query ? <a className="secondary-button" href={pathname}>Wyczyść</a> : null}</form>
    {!canWrite ? <div className="pw-protected-data"><AlertTriangle size={19}/><div><strong>Dostęp tylko do odczytu</strong><p>Administrator może nadać uprawnienie zapisu.</p></div></div> : null}
    {message ? <p className="ops-feedback ops-feedback--success">{message}</p> : null}
    {error ? <p className="ops-feedback ops-feedback--error">{error}</p> : null}
    <section className="ops-metrics">{metrics.map((metric) => <article className="ops-metric" key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><p>{metric.caption}</p></article>)}</section>
    {canWrite ? <section className="ops-form-grid">{forms.map((form) => <RecordForm key={form.entity} form={form} pending={pending} onSubmit={submit(form.entity, form.success)} />)}</section> : null}
    <section className="ops-panel ops-panel--wide" data-open="true"><div className="ops-panel__heading"><div><small>Stronicowanie serwerowe</small><h2>{tableTitle}</h2></div><span>{page.total} rekordów</span></div><div className="ops-table"><div className="ops-table__head">{columns.map((column) => <span key={column.label}>{column.label}</span>)}</div>{rows.map((row) => <div key={String(row.id)}>{columns.map((column) => <span key={column.label}>{column.value(row)}</span>)}</div>)}{!rows.length ? <p className="empty-copy">{emptyLabel}</p> : null}</div><ServerPagination page={page.page} pageSize={page.pageSize} total={page.total} pathname={pathname} query={{ q: query || undefined }} /></section>
    {children}
  </div>;
}
