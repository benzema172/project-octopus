"use client";

import dynamic from "next/dynamic";
import { useId, useState, useTransition } from "react";
import { ChevronDown, LoaderCircle, SlidersHorizontal } from "lucide-react";
import type { CompanyPowerKind } from "@/lib/data/company-power-tools";

const CompanyPowerTools = dynamic(
  () => import("@/components/company/company-power-tools").then((module) => module.CompanyPowerTools),
  { loading: () => <p className="empty-copy" role="status">Ładowanie dodatkowych narzędzi…</p> }
);

type Row = Record<string, unknown>;
type Data = Record<string, Row[]>;

export function CompanyPowerToolsDeferred({ workspaceId, kind, canWrite, referenceDate }: { workspaceId: string; kind: Exclude<CompanyPowerKind, "reports">; canWrite: boolean; referenceDate: string }) {
  const regionId = useId();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = () => {
    if (data) {
      setOpen((value) => !value);
      return;
    }
    setOpen(true);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/company/power-data?workspaceId=${encodeURIComponent(workspaceId)}&kind=${encodeURIComponent(kind)}`, { cache: "no-store" });
        const result = await response.json() as { data?: Data; error?: string };
        if (!response.ok || !result.data) {
          setError(result.error ?? "Nie udało się załadować narzędzi.");
          return;
        }
        setData(result.data);
      } catch {
        setError("Nie udało się połączyć z dodatkowymi narzędziami.");
      }
    });
  };

  return (
    <section className="ops-deferred-tools" aria-label="Dodatkowe narzędzia modułu">
      <button
        type="button"
        className="secondary-button ops-deferred-tools__trigger"
        onClick={load}
        aria-expanded={open}
        aria-controls={regionId}
        title="Narzędzia zaawansowane"
      >
        {pending ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <SlidersHorizontal size={16} aria-hidden="true" />}
        <span>
          <strong>Więcej narzędzi</strong>
          <small>Alokacje, decyzje i dodatkowe operacje — otwórz tylko, gdy są potrzebne.</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {error ? <p className="ops-feedback ops-feedback--error" role="alert">{error}</p> : null}
      <div id={regionId} hidden={!open}>
        {open && data ? <CompanyPowerTools workspaceId={workspaceId} kind={kind} data={data} canWrite={canWrite} referenceDate={referenceDate} /> : null}
      </div>
    </section>
  );
}
