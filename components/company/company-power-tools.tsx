"use client";

import type { FormEvent, ReactNode } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRightLeft, BadgeCheck, Banknote, BriefcaseBusiness, CalendarClock, CarFront,
  Check, ChevronDown, CircleDollarSign, Download, Gauge, LoaderCircle, PackageCheck, RefreshCcw,
  ShieldAlert, Sparkles, UserRoundCheck, UsersRound, Warehouse
} from "lucide-react";
import { employeeAllocationLoad, fleetEconomy, invoiceAging, stockHealth } from "@/lib/company/power-metrics";
import type { CompanyPowerKind } from "@/lib/data/company-power-tools";
import styles from "./company-power-tools.module.css";

type Row = Record<string, unknown>;
type Data = Record<string, Row[]>;
type Props = { workspaceId: string; kind: CompanyPowerKind; data: Data; canWrite: boolean; referenceDate: string };

type ActionFormProps = {
  action: string;
  success: string;
  children: ReactNode;
  submit: (action: string, success: string) => (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  button?: string;
};

function money(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function number(value: unknown, digits = 1) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

function today() { return new Date().toISOString().slice(0, 10); }
function labelEmployee(row: Row) { return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() || String(row.employee_number ?? row.id); }
function labelVehicle(row: Row) { return `${String(row.registration_number ?? "")} ${String(row.make ?? "")} ${String(row.model ?? "")}`.trim(); }

function Card({ icon, label, value, detail }: { icon: ReactNode; label: string; value: ReactNode; detail: string }) {
  return <article className={styles.metric}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function Panel({ title, subtitle, children, open = false }: { title: string; subtitle?: string; children: ReactNode; open?: boolean }) {
  return <details className={styles.panel} open={open}><summary><div><strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}</div><ChevronDown size={17} /></summary><div className={styles.panelBody}>{children}</div></details>;
}

function ActionForm({ action, success, children, submit, pending, button = "Zapisz" }: ActionFormProps) {
  return <form className={styles.form} onSubmit={submit(action, success)}>{children}<button className={styles.primary} disabled={pending}>{pending ? <LoaderCircle className={styles.spin} size={16} /> : <Check size={16} />}{button}</button></form>;
}

function Select({ name, label, rows, valueKey = "id", labeler, required = false, empty = "Wybierz" }: { name: string; label: string; rows: Row[]; valueKey?: string; labeler: (row: Row) => string; required?: boolean; empty?: string }) {
  return <label>{label}<select name={name} required={required} defaultValue=""><option value="">{empty}</option>{rows.map((row) => <option key={String(row[valueKey])} value={String(row[valueKey])}>{labeler(row)}</option>)}</select></label>;
}

function Input({ name, label, type = "text", required = false, defaultValue, placeholder }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return <label>{label}<input name={name} type={type === "number" ? "text" : type} inputMode={type === "number" ? "decimal" : undefined} required={required} defaultValue={defaultValue} placeholder={placeholder} /></label>;
}

function InlineAction({ action, success, payload, label, submit, pending, danger = false }: { action: string; success: string; payload: Record<string, string>; label: string; submit: PropsSubmit; pending: boolean; danger?: boolean }) {
  return <form onSubmit={submit(action, success)} className={styles.inlineForm}>{Object.entries(payload).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}<button disabled={pending} className={danger ? styles.danger : styles.inlineButton}>{pending ? <LoaderCircle className={styles.spin} size={14} /> : null}{label}</button></form>;
}

type PropsSubmit = (action: string, success: string) => (event: FormEvent<HTMLFormElement>) => void;

function FinanceTools({ data, submit, pending, canWrite, referenceDate }: { data: Data; submit: PropsSubmit; pending: boolean; canWrite: boolean; referenceDate: string }) {
  const invoices = data.invoices ?? [], allocations = data.allocations ?? [], projects = data.projects ?? [], commitments = data.commitments ?? [];
  const aging = invoiceAging(invoices, referenceDate);
  const projectNames = new Map(projects.map((row) => [String(row.id), String(row.name)]));
  const allocationsByInvoice = new Map(allocations.map((row) => [String(row.source_id), row]));
  const openInvoices = invoices.filter((row) => Number(row.gross_amount ?? 0) > Number(row.paid_amount ?? 0));
  const projectCost = new Map<string, number>();
  for (const allocation of allocations) {
    const key = String(allocation.project_id ?? "general");
    projectCost.set(key, (projectCost.get(key) ?? 0) + Number(allocation.amount ?? 0));
  }
  return <>
    <div className={styles.metrics}>
      <Card icon={<ShieldAlert />} label="Przeterminowane >30 dni" value={money(aging.overdue31Plus)} detail="Najpilniejsze należności i zobowiązania" />
      <Card icon={<CalendarClock />} label="Przeterminowane 8–30 dni" value={money(aging.overdue8to30)} detail="Rozrachunki wymagające kontaktu" />
      <Card icon={<Banknote />} label="Do 14 dni" value={money(aging.due14Days)} detail="Nadchodzący cash flow" />
      <Card icon={<CircleDollarSign />} label="Otwarte razem" value={money(aging.open)} detail={`${openInvoices.length} nierozliczonych faktur`} />
    </div>
    {canWrite ? <div className={styles.grid}>
      <Panel title="Przenieś fakturę między inwestycjami" subtitle="Zmiana alokacji bez przepisywania faktury" open>
        <ActionForm action="invoice_reassign" success="Faktura została przypisana do nowego kosztu/inwestycji." submit={submit} pending={pending} button="Zmień przypisanie">
          <Select name="invoiceId" label="Faktura" rows={invoices} required labeler={(row) => `${String(row.invoice_number)} · ${money(row.gross_amount)}`} />
          <Select name="projectId" label="Nowe przypisanie" rows={projects} empty="Koszty ogólne firmy" labeler={(row) => String(row.name)} />
        </ActionForm>
      </Panel>
      <Panel title="Zobowiązania – szybkie decyzje" subtitle="Zamknij lub anuluj pozycję cash flow">
        <div className={styles.list}>{commitments.map((row) => <article key={String(row.id)}><div><strong>{String(row.description)}</strong><small>{String(row.expected_date ?? "bez terminu")} · {projectNames.get(String(row.project_id)) ?? "Firma"} · {money(row.amount)}</small></div><span className={styles.actions}><InlineAction action="commitment_status" success="Zobowiązanie zostało zamknięte." payload={{ commitmentId: String(row.id), status: "closed" }} label="Zamknij" submit={submit} pending={pending} /><InlineAction action="commitment_status" success="Zobowiązanie zostało anulowane." payload={{ commitmentId: String(row.id), status: "cancelled" }} label="Anuluj" submit={submit} pending={pending} danger /></span></article>)}</div>
      </Panel>
    </div> : null}
    <Panel title="Koszty przypisane do inwestycji" subtitle="Bieżący podział faktur według alokacji">
      <div className={styles.list}>{Array.from(projectCost.entries()).sort((a, b) => b[1] - a[1]).map(([projectId, value]) => <article key={projectId}><div><strong>{projectId === "general" ? "Koszty ogólne" : projectNames.get(projectId) ?? "Inwestycja"}</strong><small>{allocations.filter((row) => String(row.project_id ?? "general") === projectId).length} alokacji</small></div><b>{money(value)}</b></article>)}</div>
      <div className={styles.listCompact}>{openInvoices.slice(0, 12).map((row) => { const allocation = allocationsByInvoice.get(String(row.id)); return <span key={String(row.id)}>{String(row.invoice_number)} · {allocation ? projectNames.get(String(allocation.project_id)) ?? "Inwestycja" : "Koszty ogólne"} · <b>{money(Number(row.gross_amount ?? 0) - Number(row.paid_amount ?? 0))}</b></span>; })}</div>
    </Panel>
  </>;
}

function HrTools({ data, submit, pending, canWrite, referenceDate }: { data: Data; submit: PropsSubmit; pending: boolean; canWrite: boolean; referenceDate: string }) {
  const employees = data.employees ?? [], projects = data.projects ?? [], employments = data.employments ?? [], assignments = data.assignments ?? [], timesheets = data.timesheets ?? [];
  const employeeNames = new Map(employees.map((row) => [String(row.id), labelEmployee(row)]));
  const projectNames = new Map(projects.map((row) => [String(row.id), String(row.name)]));
  const load = employeeAllocationLoad(assignments, referenceDate);
  const overloaded = employees.filter((row) => (load.get(String(row.id)) ?? 0) > 100);
  const unassigned = employees.filter((row) => row.status === "active" && (load.get(String(row.id)) ?? 0) === 0);
  const activeEmployments = employments.filter((row) => !row.valid_to || String(row.valid_to) >= referenceDate.slice(0, 10));
  const monthlyCost = activeEmployments.reduce((sum, row) => sum + Number(row.monthly_cost ?? 0), 0);
  const approvedHours = timesheets.filter((row) => row.status === "approved").reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
  return <>
    <div className={styles.metrics}>
      <Card icon={<UsersRound />} label="Aktywne przypisania" value={assignments.length} detail="Pracownik ↔ inwestycja ↔ rola" />
      <Card icon={<AlertTriangle />} label="Przeciążenie >100%" value={overloaded.length} detail="Osoby z nakładającymi się alokacjami" />
      <Card icon={<UserRoundCheck />} label="Bez inwestycji" value={unassigned.length} detail="Aktywni pracownicy bez bieżącej alokacji" />
      <Card icon={<BriefcaseBusiness />} label="Koszt miesięczny" value={money(monthlyCost)} detail={`${number(approvedHours)} h zatwierdzonego czasu`} />
    </div>
    {canWrite ? <div className={styles.grid}>
      <Panel title="Przypisz pracownika do inwestycji" subtitle="Rola, okres i procent zaangażowania" open>
        <ActionForm action="assignment_create" success="Pracownik został przypisany do inwestycji." submit={submit} pending={pending} button="Dodaj do zespołu">
          <Select name="employeeId" label="Pracownik" rows={employees.filter((row) => row.status === "active")} required labeler={labelEmployee} />
          <Select name="projectId" label="Inwestycja" rows={projects} required labeler={(row) => String(row.name)} />
          <Input name="role" label="Rola" required placeholder="Kierownik robót, monter, koordynator" />
          <Input name="allocationPercent" label="Zaangażowanie %" type="number" required placeholder="100" />
          <Input name="dateFrom" label="Od" type="date" defaultValue={today()} />
          <Input name="dateTo" label="Do" type="date" />
        </ActionForm>
      </Panel>
      <Panel title="Nowe warunki zatrudnienia" subtitle="Historia umów i kosztu pracownika">
        <ActionForm action="employment_create" success="Nowe warunki zatrudnienia zostały zapisane." submit={submit} pending={pending} button="Dodaj okres zatrudnienia">
          <Select name="employeeId" label="Pracownik" rows={employees} required labeler={labelEmployee} />
          <label>Forma<select name="employmentType" defaultValue="employment_contract"><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label>
          <Input name="position" label="Stanowisko" />
          <Input name="validFrom" label="Od" type="date" required defaultValue={today()} />
          <Input name="validTo" label="Do" type="date" />
          <Input name="fullTimeEquivalent" label="Wymiar etatu" type="number" placeholder="1,0" />
          <Input name="monthlyCost" label="Koszt miesięczny" type="number" />
          <Input name="hourlyCost" label="Koszt godzinowy" type="number" />
        </ActionForm>
      </Panel>
    </div> : null}
    <Panel title="Obłożenie zespołu" subtitle="Suma aktywnych alokacji na dziś" open>
      <div className={styles.loadGrid}>{employees.filter((row) => row.status === "active").map((row) => { const pct = load.get(String(row.id)) ?? 0; return <article key={String(row.id)} className={pct > 100 ? styles.overload : ""}><div><strong>{employeeNames.get(String(row.id))}</strong><small>{assignments.filter((a) => String(a.employee_id) === String(row.id)).map((a) => projectNames.get(String(a.project_id)) ?? "Inwestycja").join(" · ") || "Brak przypisania"}</small></div><b>{number(pct, 0)}%</b><progress max="120" value={Math.min(120, pct)} /></article>; })}</div>
    </Panel>
  </>;
}

function WarehouseTools({ data, submit, pending, canWrite }: { data: Data; submit: PropsSubmit; pending: boolean; canWrite: boolean }) {
  const projects = data.projects ?? [], warehouses = data.warehouses ?? [], items = data.items ?? [], reservations = data.reservations ?? [], balances = data.balances ?? [];
  const health = stockHealth(items, balances);
  const itemById = new Map(items.map((row) => [String(row.id), row]));
  const warehouseNames = new Map(warehouses.map((row) => [String(row.id), String(row.name)]));
  const projectNames = new Map(projects.map((row) => [String(row.id), String(row.name)]));
  const low = health.filter((row) => row.low);
  const openReservations = reservations.filter((row) => row.status === "open");
  return <>
    <div className={styles.metrics}>
      <Card icon={<ShieldAlert />} label="Poniżej minimum" value={low.length} detail="Kartoteki wymagające zakupu lub przesunięcia" />
      <Card icon={<PackageCheck />} label="Rezerwacje otwarte" value={openReservations.length} detail="Materiały czekające na wydanie" />
      <Card icon={<Warehouse />} label="Magazyny" value={warehouses.length} detail={`${items.filter((row) => row.active !== false).length} aktywnych kartotek`} />
      <Card icon={<ArrowRightLeft />} label="Niedobór ilościowy" value={number(low.reduce((sum, row) => sum + row.shortage, 0))} detail="Suma braków do stanów minimalnych" />
    </div>
    {canWrite ? <div className={styles.grid}>
      <Panel title="Szybkie MM – przesunięcie magazynowe" subtitle="Z kontrolą dostępnego stanu" open>
        <ActionForm action="stock_transfer" success="Przesunięcie MM zostało wykonane." submit={submit} pending={pending} button="Przenieś materiał">
          <Select name="warehouseId" label="Z magazynu" rows={warehouses} required labeler={(row) => String(row.name)} />
          <Select name="targetWarehouseId" label="Do magazynu" rows={warehouses} required labeler={(row) => String(row.name)} />
          <Select name="stockItemId" label="Materiał / sprzęt" rows={items.filter((row) => row.active !== false)} required labeler={(row) => `${String(row.sku ?? "—")} · ${String(row.name)}`} />
          <Select name="projectId" label="Inwestycja" rows={projects} empty="Ruch ogólnofirmowy" labeler={(row) => String(row.name)} />
          <Input name="quantity" label="Ilość" type="number" required />
          <Input name="movementDate" label="Data" type="date" defaultValue={today()} />
          <Input name="documentNumber" label="Numer MM" placeholder="Automatyczny, jeśli puste" />
        </ActionForm>
      </Panel>
      <Panel title="Rezerwacje → rzeczywiste RW" subtitle="Jednym kliknięciem wydaj materiał na inwestycję">
        <div className={styles.list}>{openReservations.map((row) => { const item = itemById.get(String(row.stock_item_id)); return <article key={String(row.id)}><div><strong>{String(item?.name ?? "Kartoteka")}</strong><small>{number(row.quantity)} {String(item?.unit ?? "")} · {warehouseNames.get(String(row.warehouse_id)) ?? "Magazyn"} → {projectNames.get(String(row.project_id)) ?? "Inwestycja"}</small></div><span className={styles.actions}><InlineAction action="reservation_issue" success="Materiał wydano dokumentem RW i zamknięto rezerwację." payload={{ reservationId: String(row.id) }} label="Wydaj RW" submit={submit} pending={pending} /><InlineAction action="reservation_status" success="Rezerwacja została anulowana." payload={{ reservationId: String(row.id), status: "cancelled" }} label="Anuluj" submit={submit} pending={pending} danger /></span></article>; })}</div>
      </Panel>
    </div> : null}
    <div className={styles.grid}>
      <Panel title="Alerty stanów minimalnych" subtitle="Stan całej firmy vs minimum kartoteki" open>
        <div className={styles.list}>{low.map((healthRow) => { const item = itemById.get(healthRow.id); return <article key={healthRow.id}><div><strong>{String(item?.name ?? "Kartoteka")}</strong><small>{String(item?.sku ?? "—")} · stan {number(healthRow.quantity)} / min. {number(healthRow.minimum)}</small></div><b className={styles.negative}>brakuje {number(healthRow.shortage)}</b></article>; })}{!low.length ? <p className={styles.empty}>Wszystkie kartoteki są powyżej stanów minimalnych.</p> : null}</div>
      </Panel>
      {canWrite ? <Panel title="Aktywność kartotek" subtitle="Wycofaj pozycje nieużywane bez kasowania historii"><div className={styles.list}>{items.map((row) => <article key={String(row.id)}><div><strong>{String(row.name)}</strong><small>{String(row.sku ?? "—")} · {row.active === false ? "nieaktywna" : "aktywna"}</small></div><InlineAction action="stock_item_status" success="Status kartoteki został zmieniony." payload={{ stockItemId: String(row.id), active: row.active === false ? "true" : "false" }} label={row.active === false ? "Aktywuj" : "Wycofaj"} submit={submit} pending={pending} danger={row.active !== false} /></article>)}</div></Panel> : null}
    </div>
  </>;
}

function FleetTools({ data, submit, pending, canWrite }: { data: Data; submit: PropsSubmit; pending: boolean; canWrite: boolean }) {
  const projects = data.projects ?? [], employees = data.employees ?? [], vehicles = data.vehicles ?? [], fuel = data.fuel ?? [], trips = data.trips ?? [], service = data.service ?? [], damages = data.damages ?? [], allocations = data.allocations ?? [], readings = data.readings ?? [];
  const economy = fleetEconomy(vehicles, fuel, trips, service, damages);
  const vehicleNames = new Map(vehicles.map((row) => [String(row.id), labelVehicle(row)]));
  const projectNames = new Map(projects.map((row) => [String(row.id), String(row.name)]));
  const employeeNames = new Map(employees.map((row) => [String(row.id), labelEmployee(row)]));
  const activeDamage = damages.filter((row) => !["closed", "cancelled"].includes(String(row.status)));
  const openService = service.filter((row) => row.status === "open");
  const totalCost = economy.reduce((sum, row) => sum + row.totalCost, 0);
  const totalDistance = economy.reduce((sum, row) => sum + row.distance, 0);
  return <>
    <div className={styles.metrics}>
      <Card icon={<CarFront />} label="Pojazdy aktywne" value={vehicles.filter((row) => row.status === "active").length} detail={`${allocations.length} zapisanych alokacji`} />
      <Card icon={<Gauge />} label="Średni koszt / km" value={totalDistance ? `${money(totalCost / totalDistance)}/km` : "—"} detail={`${number(totalDistance)} km zarejestrowanych tras`} />
      <Card icon={<RefreshCcw />} label="Otwarte serwisy" value={openService.length} detail="Zlecenia wymagające domknięcia" />
      <Card icon={<ShieldAlert />} label="Aktywne szkody" value={activeDamage.length} detail="Zgłoszone lub w likwidacji" />
    </div>
    {canWrite ? <div className={styles.grid}>
      <Panel title="Przypisz pojazd" subtitle="Do inwestycji, pracownika lub obu" open>
        <ActionForm action="vehicle_allocation_create" success="Alokacja pojazdu została zapisana." submit={submit} pending={pending} button="Przypisz pojazd">
          <Select name="vehicleId" label="Pojazd" rows={vehicles.filter((row) => row.status === "active")} required labeler={labelVehicle} />
          <Select name="projectId" label="Inwestycja" rows={projects} empty="Bez inwestycji" labeler={(row) => String(row.name)} />
          <Select name="employeeId" label="Pracownik" rows={employees.filter((row) => row.status === "active")} empty="Bez pracownika" labeler={labelEmployee} />
          <Input name="dateFrom" label="Od" type="date" required defaultValue={today()} />
          <Input name="dateTo" label="Do" type="date" />
          <Input name="allocationPercent" label="Alokacja %" type="number" placeholder="100" />
          <label>Metoda<select name="allocationMethod" defaultValue="time"><option value="time">Czas</option><option value="distance">Kilometry</option><option value="fixed">Stała</option></select></label>
        </ActionForm>
      </Panel>
      <Panel title="Odczyt licznika" subtitle="Aktualizuje przebieg pojazdu z kontrolą cofnięcia licznika">
        <ActionForm action="meter_reading_create" success="Przebieg pojazdu został zaktualizowany." submit={submit} pending={pending} button="Zapisz przebieg">
          <Select name="vehicleId" label="Pojazd" rows={vehicles} required labeler={labelVehicle} />
          <Input name="readingDate" label="Data" type="date" required defaultValue={today()} />
          <Input name="mileage" label="Przebieg km" type="number" required />
        </ActionForm>
        <div className={styles.listCompact}>{readings.slice(0, 8).map((row) => <span key={String(row.id)}>{vehicleNames.get(String(row.vehicle_id)) ?? "Pojazd"} · {String(row.reading_date)} · <b>{number(row.mileage)} km</b></span>)}</div>
      </Panel>
    </div> : null}
    <Panel title="Ekonomia floty per pojazd" subtitle="Paliwo + serwis + szkody względem zarejestrowanych tras" open>
      <div className={styles.table}><div><b>Pojazd</b><b>Dystans</b><b>Spalanie*</b><b>Koszt / km</b><b>Koszt razem</b></div>{economy.map((row) => <div key={row.id}><strong>{vehicleNames.get(row.id) ?? "Pojazd"}</strong><span>{number(row.distance)} km</span><span>{row.distance ? `${number(row.litersPer100Km)} l/100 km` : "—"}</span><span>{row.distance ? `${money(row.costPerKm)}/km` : "—"}</span><b>{money(row.totalCost)}</b></div>)}</div><p className={styles.hint}>* Spalanie jest liczone z zarejestrowanych tankowań względem tras w systemie; przy niepełnej ewidencji traktuj je jako wskaźnik, nie wartość homologacyjną.</p>
    </Panel>
    <div className={styles.grid}>
      <Panel title="Bieżące alokacje" subtitle="Kto i na jakiej inwestycji używa pojazdu"><div className={styles.list}>{allocations.slice(0, 30).map((row) => <article key={String(row.id)}><div><strong>{vehicleNames.get(String(row.vehicle_id)) ?? "Pojazd"}</strong><small>{projectNames.get(String(row.project_id)) ?? "Bez inwestycji"} · {employeeNames.get(String(row.employee_id)) ?? "Bez pracownika"} · {String(row.date_from)}{row.date_to ? `–${String(row.date_to)}` : ""}</small></div><b>{row.allocation_percent ? `${number(row.allocation_percent, 0)}%` : String(row.allocation_method ?? "czas")}</b></article>)}</div></Panel>
      <Panel title="Szkody – workflow" subtitle="Zgłoszona → w toku → zamknięta"><div className={styles.list}>{activeDamage.map((row) => <article key={String(row.id)}><div><strong>{vehicleNames.get(String(row.vehicle_id)) ?? "Pojazd"}</strong><small>{String(row.description)} · {money(row.cost)} · {String(row.status)}</small></div>{canWrite ? <span className={styles.actions}><InlineAction action="damage_status" success="Szkoda została przekazana do realizacji." payload={{ damageId: String(row.id), status: "in_progress" }} label="W toku" submit={submit} pending={pending} /><InlineAction action="damage_status" success="Szkoda została zamknięta." payload={{ damageId: String(row.id), status: "closed" }} label="Zamknij" submit={submit} pending={pending} /></span> : null}</article>)}</div></Panel>
    </div>
  </>;
}

function ReportTools({ data, submit, pending, canWrite }: { data: Data; submit: PropsSubmit; pending: boolean; canWrite: boolean }) {
  const definitions = data.definitions ?? [], runs = data.runs ?? [];
  const active = definitions.filter((row) => row.active !== false);
  const errors = runs.filter((row) => row.status === "error");
  const success = runs.filter((row) => ["completed", "success"].includes(String(row.status))).length;
  return <>
    <div className={styles.metrics}>
      <Card icon={<BadgeCheck />} label="Aktywne definicje" value={active.length} detail={`${definitions.length} definicji łącznie`} />
      <Card icon={<Sparkles />} label="Uruchomienia" value={runs.length} detail="Historia generacji raportów" />
      <Card icon={<ShieldAlert />} label="Błędy" value={errors.length} detail="Wykonania wymagające sprawdzenia" />
      <Card icon={<Check />} label="Udane" value={success} detail="Zakończone przebiegi raportowe" />
    </div>
    <Panel title="Sterowanie definicjami raportów" subtitle="Włączaj i wyłączaj cykliczne raporty bez usuwania konfiguracji" open>
      <div className={styles.list}>{definitions.map((row) => <article key={String(row.id)}><div><strong>{String(row.name)}</strong><small>{String(row.report_type)} · {String(row.schedule_rule ?? "manual")} · {row.active === false ? "wyłączony" : "aktywny"}</small></div>{canWrite ? <InlineAction action="report_definition_status" success="Status definicji raportu został zmieniony." payload={{ definitionId: String(row.id), active: row.active === false ? "true" : "false" }} label={row.active === false ? "Włącz" : "Wstrzymaj"} submit={submit} pending={pending} danger={row.active !== false} /> : null}</article>)}</div>
    </Panel>
  </>;
}

export function CompanyPowerTools({ workspaceId, kind, data, canWrite, referenceDate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit: PropsSubmit = (action, success) => (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setMessage(null); setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/power", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action, payload }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) { setError(result.error ?? "Nie udało się wykonać operacji."); return; }
        form.reset(); setMessage(success); router.refresh();
      } catch {
        setError("Nie udało się połączyć z modułem operacyjnym.");
      }
    });
  };

  return <section className={styles.shell} aria-label="Narzędzia operacyjne wersji 0.8.0">
    <header className={styles.header}><div><p>PROJECT OCTOPUS 0.8.0</p><h2>Centrum operacyjne</h2><span>Dodatkowe akcje w tej samej zakładce: decyzje, alokacje, kontrola stanów, terminy i eksport danych.</span></div><div className={styles.export}><a href={`/api/company/export?workspaceId=${workspaceId}&kind=${kind}&format=csv`}><Download size={15} />CSV</a><a href={`/api/company/export?workspaceId=${workspaceId}&kind=${kind}&format=json`}><Download size={15} />JSON</a></div></header>
    {!canWrite ? <div className={styles.notice}><AlertTriangle size={17} /><span>Tryb tylko do odczytu – analityka i eksport działają, akcje zmieniające dane są ukryte.</span></div> : null}
    {message ? <div className={styles.success}>{message}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
    {kind === "finance" ? <FinanceTools data={data} submit={submit} pending={pending} canWrite={canWrite} referenceDate={referenceDate} /> : null}
    {kind === "hr" ? <HrTools data={data} submit={submit} pending={pending} canWrite={canWrite} referenceDate={referenceDate} /> : null}
    {kind === "warehouse" ? <WarehouseTools data={data} submit={submit} pending={pending} canWrite={canWrite} /> : null}
    {kind === "fleet" ? <FleetTools data={data} submit={submit} pending={pending} canWrite={canWrite} /> : null}
    {kind === "reports" ? <ReportTools data={data} submit={submit} pending={pending} canWrite={canWrite} /> : null}
  </section>;
}
