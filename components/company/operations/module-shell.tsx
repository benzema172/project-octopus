"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, MoreHorizontal, Plus, Save, Search, X } from "lucide-react";
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

const ATOMIC_WAREHOUSE_ENTITIES = new Set(["ai_warehouse_import", "reservation", "stock_movement_approve", "stock_movement_destination"]);

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
  layoutVariant?: "default" | "finance";
  primaryMetricCount?: number;
  children?: ReactNode;
};

function optionLabel(row: Row, key = "name") {
  return String(row[key] ?? row.name ?? row.title ?? row.registration_number ?? row.employee_number ?? row.id ?? "—");
}

function RecordForm({ form, pending, open, onToggle, onSubmit }: { form: FormSpec; pending: boolean; open: boolean; onToggle: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <details className={`ops-form-card${form.wide ? " ops-form-card--wide" : ""}`} open={open}>
      <summary
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        <span className="ops-form-card__summary-icon"><Plus size={15} aria-hidden="true" /></span>
        <strong>{form.title}</strong>
        <ChevronDown className="ops-form-card__chevron" size={15} aria-hidden="true" />
      </summary>
      <form className="ops-form-card__body" onSubmit={onSubmit}>
        <div className="ops-form-fields">
          {form.fields.map((field) => (
            <label key={field.name}>
              <span>{field.label}</span>
              {field.rows || field.options || field.type === "select" ? (
                <select name={field.name} required={field.required} defaultValue={field.defaultValue ?? ""}>
                  <option value="">{field.placeholder ?? (field.required ? "Wybierz" : "—")}</option>
                  {field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  {field.rows?.map((row) => <option key={String(row.id)} value={String(row.id)}>{optionLabel(row, field.labelKey)}</option>)}
                </select>
              ) : (
                <input
                  name={field.name}
                  type={field.type ?? "text"}
                  required={field.required}
                  placeholder={field.placeholder}
                  defaultValue={field.defaultValue}
                  step={field.type === "number" ? "any" : undefined}
                />
              )}
            </label>
          ))}
        </div>
        <button className="primary-button" type="submit" disabled={pending}>
          <Save size={15} aria-hidden="true" />
          {pending ? "Zapisywanie…" : "Zapisz"}
        </button>
      </form>
    </details>
  );
}

export function CompanyModuleShell({ workspaceId, data, canWrite, pathname, query, metrics, forms, rows, columns, emptyLabel, tableTitle, layoutVariant = "default", primaryMetricCount = 3, children }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFormKey, setOpenFormKey] = useState<string | null>(null);
  const page = data.page ?? { page: 1, pageSize: Math.max(rows.length, 1), total: rows.length };
  const primaryMetrics = metrics.slice(0, primaryMetricCount);
  const secondaryMetrics = metrics.slice(primaryMetricCount);

  const submit = (entity: string, success: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const endpoint = ATOMIC_WAREHOUSE_ENTITIES.has(entity) ? "/api/company/warehouse-atomic" : "/api/company/records";
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, entity, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          setError(result.error ?? "Nie udało się zapisać danych.");
          return;
        }
        form.reset();
        setMessage(success);
        setOpenFormKey(null);
        router.refresh();
      } catch {
        setError("Nie udało się połączyć z modułem operacyjnym.");
      }
    });
  };

  const renderMetrics = (items: MetricSpec[]) => items.map((metric) => (
    <article className="ops-metric" key={metric.label}>
      <small>{metric.label}</small>
      <strong>{metric.value}</strong>
      <p>{metric.caption}</p>
    </article>
  ));

  return (
    <div className={`ops-workspace ops-workspace--paged${layoutVariant === "finance" ? " ops-workspace--finance" : ""}`}>
      <div className="ops-action-bar">
        <form className="ops-search" method="get" action={pathname} role="search">
          <label className="ops-search__field">
            <Search size={17} aria-hidden="true" />
            <span className="ux-sr-only">Szukaj w module</span>
            <input name="q" defaultValue={query} placeholder="Szukaj po nazwie, numerze lub opisie…" />
            {query ? <Link className="ops-search__clear" href={pathname} aria-label="Wyczyść wyszukiwanie" title="Wyczyść"><X size={15} aria-hidden="true" /></Link> : null}
          </label>
        </form>
        {canWrite && forms.length ? (
          <details className="ops-add-menu">
            <summary className="primary-button"><Plus size={16} aria-hidden="true" /> Dodaj <ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="ops-add-menu__panel">
              <div className="ops-add-menu__heading"><strong>Dodaj lub zarejestruj</strong><small>Wybierz czynność</small></div>
              <div className="ops-form-grid">
                {forms.map((form) => {
                  const formKey = `${form.entity}-${form.title}`;
                  return (
                    <RecordForm
                      key={formKey}
                      form={form}
                      pending={pending}
                      open={openFormKey === formKey}
                      onToggle={() => setOpenFormKey((current) => current === formKey ? null : formKey)}
                      onSubmit={submit(form.entity, form.success)}
                    />
                  );
                })}
              </div>
            </div>
          </details>
        ) : null}
      </div>

      {!canWrite ? (
        <div className="pw-protected-data" role="note">
          <AlertTriangle size={19} aria-hidden="true" />
          <div><strong>Dostęp tylko do odczytu</strong><p>Administrator może nadać uprawnienie zapisu.</p></div>
        </div>
      ) : null}

      <div className="ops-feedback-stack" aria-live="polite">
        {message ? <p className="ops-feedback ops-feedback--success" role="status">{message}</p> : null}
        {error ? <p className="ops-feedback ops-feedback--error" role="alert">{error}</p> : null}
      </div>

      {primaryMetrics.length ? <section className="ops-metrics ops-metrics--primary" aria-label="Najważniejsze informacje">{renderMetrics(primaryMetrics)}</section> : null}
      {secondaryMetrics.length ? (
        <details className="ops-secondary-metrics">
          <summary><MoreHorizontal size={16} aria-hidden="true" /> Więcej wskaźników <span>{secondaryMetrics.length}</span></summary>
          <section className="ops-metrics" aria-label="Dodatkowe wskaźniki">{renderMetrics(secondaryMetrics)}</section>
        </details>
      ) : null}

      <section className="ops-panel ops-panel--wide" data-open="true" aria-labelledby="ops-records-heading">
        <div className="ops-panel__heading">
          <div>
            <small>Rejestr</small>
            <h2 id="ops-records-heading">{tableTitle}</h2>
          </div>
          <span>{page.total} rekordów</span>
        </div>
        <div className="ops-table" role="table" aria-label={tableTitle}>
          <div className="ops-table__head" role="row">
            {columns.map((column) => <span key={column.label} role="columnheader">{column.label}</span>)}
          </div>
          {rows.map((row) => (
            <div className="ops-table__row" role="row" key={String(row.id)}>
              {columns.map((column) => (
                <span className="ops-table__cell" role="cell" data-label={column.label} key={column.label}>{column.value(row)}</span>
              ))}
            </div>
          ))}
          {!rows.length ? <p className="empty-copy">{emptyLabel}</p> : null}
        </div>
        <ServerPagination page={page.page} pageSize={page.pageSize} total={page.total} pathname={pathname} query={{ q: query || undefined }} />
      </section>

      {children}
    </div>
  );
}