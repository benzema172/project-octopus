"use client";

import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function str(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

export default function ReportsOperations({
  workspaceId,
  data,
  canWrite,
  pathname,
  query
}: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove?: boolean;
  pathname: string;
  query: string;
}) {
  const definitions = (data.definitions ?? []) as Row[];
  const runs = (data.runs ?? []) as Row[];
  const snapshots = (data.snapshots ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const projectById = new Map(projects.map((row) => [String(row.id), str(row.name)]));
  const completedRuns = runs.filter((row) => row.status === "completed").length;
  const failedRuns = runs.filter((row) => row.status === "error").length;
  const latestSnapshot = snapshots[0];
  const latestDate = latestSnapshot?.closed_at ?? latestSnapshot?.created_at;

  const forms: FormSpec[] = [
    {
      title: "Nowa definicja raportu",
      entity: "report_definition",
      success: "Definicja raportu została zapisana.",
      fields: [
        { name: "name", label: "Nazwa", required: true },
        { name: "reportType", label: "Typ", type: "select", options: [["management", "Zarządczy firmy"], ["project", "Inwestycja"], ["finance", "Finansowy"], ["hr", "Kadrowy"], ["warehouse", "Magazynowy"], ["fleet", "Flotowy"]] },
        { name: "projectId", label: "Inwestycja", rows: projects, placeholder: "Cała firma" },
        { name: "scheduleRule", label: "Cykl", type: "select", options: [["manual", "Ręcznie"], ["weekly", "Tygodniowo"], ["monthly", "Miesięcznie"]] }
      ]
    },
    {
      title: "Generuj zamknięty snapshot",
      entity: "report_generate",
      success: "Raport został wygenerowany i zamknięty w snapshot.",
      fields: [
        { name: "definitionId", label: "Definicja", rows: definitions, required: true },
        { name: "periodStart", label: "Okres od", type: "date" },
        { name: "periodEnd", label: "Okres do", type: "date", defaultValue: new Date().toISOString().slice(0, 10) }
      ]
    }
  ];

  const metrics = [
    { label: "Definicje", value: definitions.length, caption: `${definitions.filter((row) => row.active !== false).length} aktywnych` },
    { label: "Snapshoty", value: snapshots.length, caption: latestDate ? `Ostatni: ${new Date(String(latestDate)).toLocaleDateString("pl-PL")}` : "Brak zamkniętych raportów" },
    { label: "Wygenerowane", value: completedRuns, caption: `${runs.length} uruchomień łącznie` },
    { label: "Błędy", value: failedRuns, caption: failedRuns ? "Wymagają sprawdzenia" : "Brak błędnych uruchomień" }
  ];

  return (
    <CompanyModuleShell
      workspaceId={workspaceId}
      data={data}
      canWrite={canWrite}
      pathname={pathname}
      query={query}
      metrics={metrics}
      forms={forms}
      rows={snapshots}
      tableTitle="Zamknięte snapshoty"
      emptyLabel="Brak snapshotów raportów."
      columns={[
        { label: "Zamknięto", value: (row) => str(row.closed_at ?? row.created_at) },
        { label: "Inwestycja", value: (row) => row.project_id ? projectById.get(String(row.project_id)) ?? "Inwestycja" : "Cała firma" },
        { label: "ID", value: (row) => <code>{String(row.id).slice(0, 8)}</code> },
        { label: "CSV", value: (row) => <a className="secondary-button" href={`/api/company/reports/${String(row.id)}?format=csv`}>Pobierz</a> },
        { label: "JSON", value: (row) => <a className="secondary-button" href={`/api/company/reports/${String(row.id)}?format=json`}>Pobierz</a> }
      ]}
    >
      <section className="ops-panel ops-panel--wide">
        <div className="ops-panel__heading"><div><small>Uruchomienia</small><h2>Ostatnia historia generowania</h2></div><span>{runs.length} rekordów</span></div>
        <div className="ops-simple-list">
          {runs.slice(0, 20).map((row) => <div key={String(row.id)}><span>{str(row.created_at)}</span><strong>{str(row.status)}</strong><div className="ops-list-row__detail">{str(row.period_start, "początek")} – {str(row.period_end, "dzisiaj")}</div></div>)}
          {!runs.length ? <p className="empty-copy">Brak uruchomień raportów.</p> : null}
        </div>
      </section>
    </CompanyModuleShell>
  );
}
