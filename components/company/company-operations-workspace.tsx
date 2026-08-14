"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Boxes, CalendarClock, CarFront, FileBarChart, LoaderCircle, Plus, ReceiptText, Save, UsersRound, WalletCards } from "lucide-react";

type Row = Record<string, unknown>;
type Data = Record<string, Row[]>;
type Kind = "finance" | "hr" | "warehouse" | "fleet" | "reports";

type Props = {
  workspaceId: string;
  kind: Kind;
  data: Data;
  canWrite: boolean;
  referenceDate: string;
};

function money(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function number(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function label(row: Row, primary = "name") {
  return String(row[primary] ?? row.id ?? "—");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function SelectRows({ name, rows, labelKey = "name", placeholder, required = false }: { name: string; rows: Row[]; labelKey?: string; placeholder: string; required?: boolean }) {
  return <select name={name} required={required} defaultValue=""><option value="">{placeholder}</option>{rows.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row, labelKey)}</option>)}</select>;
}

export function CompanyOperationsWorkspace({ workspaceId, kind, data, canWrite, referenceDate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(entity: string, success: string) {
    return (event: FormEvent<HTMLFormElement>) => {
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
  }

  const feedback = <>{message ? <p className="ops-feedback ops-feedback--success">{message}</p> : null}{error ? <p className="ops-feedback ops-feedback--error">{error}</p> : null}</>;
  const readOnly = !canWrite ? <div className="pw-protected-data"><AlertTriangle size={19} /><div><strong>Dostęp tylko do odczytu</strong><p>Administrator może nadać uprawnienie zapisu dla tego modułu.</p></div></div> : null;

  if (kind === "finance") {
    const counterparties = data.counterparties ?? [];
    const invoices = data.invoices ?? [];
    const payments = data.payments ?? [];
    const commitments = data.commitments ?? [];
    const projects = data.projects ?? [];
    const sales = invoices.filter((row) => row.direction === "sale").reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
    const purchases = invoices.filter((row) => row.direction === "purchase").reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
    const paid = invoices.reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0);
    const open = invoices.reduce((sum, row) => sum + Math.max(0, Number(row.gross_amount ?? 0) - Number(row.paid_amount ?? 0)), 0);
    const counterpartyNames = new Map(counterparties.map((row) => [String(row.id), String(row.name)]));
    return <div className="ops-workspace">
      <section className="ops-metrics"><article><WalletCards /><span>Sprzedaż brutto</span><strong>{money(sales)}</strong><small>Z rejestru faktur</small></article><article><ReceiptText /><span>Zakupy brutto</span><strong>{money(purchases)}</strong><small>Koszt dokumentowany</small></article><article><Save /><span>Rozliczono</span><strong>{money(paid)}</strong><small>Wpłaty i zapłaty</small></article><article><CalendarClock /><span>Do rozliczenia</span><strong>{money(open)}</strong><small>Należności i zobowiązania</small></article></section>
      {readOnly}{feedback}
      {canWrite ? <section className="ops-form-grid">
        <article className="ops-panel"><h2>Dodaj kontrahenta</h2><form onSubmit={submit("counterparty", "Kontrahent został dodany.")} className="ops-form"><label>Nazwa<input name="name" required /></label><div className="form-row"><label>NIP<input name="taxId" /></label><label>Rola<select name="role" defaultValue="supplier"><option value="supplier">Dostawca</option><option value="customer">Klient</option><option value="subcontractor">Podwykonawca</option></select></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj kontrahenta</button></form></article>
        <article className="ops-panel ops-panel--wide"><h2>Zarejestruj fakturę</h2><form onSubmit={submit("invoice", "Faktura została zapisana.")} className="ops-form"><div className="form-row"><label>Numer<input name="invoiceNumber" required /></label><label>Rodzaj<select name="direction" defaultValue="purchase"><option value="purchase">Zakupowa</option><option value="sale">Sprzedażowa</option></select></label></div><label>Kontrahent<SelectRows name="counterpartyId" rows={counterparties} placeholder="Bez przypisania" /></label><div className="form-row"><label>Data wystawienia<input type="date" name="issueDate" defaultValue={today()} /></label><label>Termin płatności<input type="date" name="dueDate" /></label></div><div className="form-row form-row--three"><label>Netto<input name="netAmount" inputMode="decimal" /></label><label>VAT<input name="taxAmount" inputMode="decimal" /></label><label>Brutto<input name="grossAmount" inputMode="decimal" required /></label></div><button disabled={pending} className="primary-button"><ReceiptText size={16} />Zapisz fakturę</button></form></article>
        <article className="ops-panel"><h2>Zarejestruj płatność</h2><form onSubmit={submit("payment", "Płatność została rozliczona z fakturą.")} className="ops-form"><label>Faktura<select name="invoiceId" required defaultValue=""><option value="">Wybierz fakturę</option>{invoices.map((row) => <option key={String(row.id)} value={String(row.id)}>{row.invoice_number as string} · {money(row.gross_amount)}</option>)}</select></label><div className="form-row"><label>Data<input type="date" name="paymentDate" defaultValue={today()} /></label><label>Kwota<input name="amount" inputMode="decimal" required /></label></div><label>Referencja bankowa<input name="bankReference" /></label><button disabled={pending} className="primary-button"><Save size={16} />Zapisz płatność</button></form></article>
        <article className="ops-panel"><h2>Dodaj zobowiązanie</h2><form onSubmit={submit("commitment", "Zobowiązanie zostało dodane do cash flow.")} className="ops-form"><label>Opis<input name="description" required /></label><label>Inwestycja<SelectRows name="projectId" rows={projects} placeholder="Koszt ogólnofirmowy" /></label><div className="form-row"><label>Wartość<input name="amount" inputMode="decimal" required /></label><label>Planowana data<input type="date" name="expectedDate" /></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj zobowiązanie</button></form></article>
      </section> : null}
      <section className="ops-panel"><div className="section-heading"><div><p className="eyebrow">Rejestr finansowy</p><h2>Faktury i rozrachunki</h2></div><span>{invoices.length} faktur · {payments.length} płatności · {commitments.length} zobowiązań</span></div><div className="ops-table"><div className="ops-table__head"><span>Dokument</span><span>Kontrahent</span><span>Termin</span><span>Brutto</span><span>Pozostało</span><span>Status</span></div>{invoices.map((row) => <div key={String(row.id)}><strong>{String(row.invoice_number)}</strong><span>{counterpartyNames.get(String(row.counterparty_id)) ?? "—"}</span><span>{String(row.due_date ?? "—")}</span><span>{money(row.gross_amount)}</span><span>{money(Math.max(0, Number(row.gross_amount ?? 0) - Number(row.paid_amount ?? 0)))}</span><span className="status-chip">{String(row.status)}</span></div>)}{!invoices.length ? <p className="empty-copy">Dodaj pierwszą fakturę, aby uruchomić wynik i cash flow.</p> : null}</div></section>
    </div>;
  }

  if (kind === "hr") {
    const employees = data.employees ?? [];
    const employments = data.employments ?? [];
    const qualifications = data.qualifications ?? [];
    const exams = data.exams ?? [];
    const leaves = data.leaves ?? [];
    const timesheets = data.timesheets ?? [];
    const projects = data.projects ?? [];
    const monthHours = timesheets.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
    const expiring = [...qualifications, ...exams].filter((row) => row.valid_until && Date.parse(String(row.valid_until)) <= Date.parse(referenceDate) + 30 * 86_400_000).length;
    return <div className="ops-workspace">
      <section className="ops-metrics"><article><UsersRound /><span>Pracownicy aktywni</span><strong>{employees.filter((row) => row.status === "active").length}</strong><small>Kartoteka firmy</small></article><article><CalendarClock /><span>Godziny zarejestrowane</span><strong>{number(monthHours)} h</strong><small>Ostatnie wpisy czasu</small></article><article><AlertTriangle /><span>Terminy do 30 dni</span><strong>{expiring}</strong><small>Badania i uprawnienia</small></article><article><FileBarChart /><span>Urlopy oczekujące</span><strong>{leaves.filter((row) => row.status === "pending").length}</strong><small>Do zatwierdzenia</small></article></section>
      {readOnly}{feedback}
      {canWrite ? <section className="ops-form-grid">
        <article className="ops-panel ops-panel--wide"><h2>Dodaj pracownika</h2><form onSubmit={submit("employee", "Pracownik i warunki zatrudnienia zostały zapisane.")} className="ops-form"><div className="form-row"><label>Imię<input name="firstName" required /></label><label>Nazwisko<input name="lastName" required /></label></div><div className="form-row form-row--three"><label>Numer pracownika<input name="employeeNumber" /></label><label>E-mail<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label></div><div className="form-row form-row--three"><label>Forma zatrudnienia<select name="employmentType" defaultValue="employment_contract"><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label><label>Stanowisko<input name="position" /></label><label>Data zatrudnienia<input type="date" name="hiredAt" defaultValue={today()} /></label></div><div className="form-row"><label>Koszt miesięczny<input name="monthlyCost" inputMode="decimal" /></label><label>Koszt godzinowy<input name="hourlyCost" inputMode="decimal" /></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj pracownika</button></form></article>
        <article className="ops-panel"><h2>Dodaj uprawnienie</h2><form onSubmit={submit("qualification", "Uprawnienie zostało przypisane.")} className="ops-form"><label>Pracownik<SelectRows name="employeeId" rows={employees.map((row) => ({ ...row, name: `${row.first_name} ${row.last_name}` }))} placeholder="Wybierz pracownika" required /></label><label>Rodzaj<input name="qualificationType" placeholder="np. SEP, UDT, F-gazy" required /></label><div className="form-row"><label>Numer<input name="number" /></label><label>Ważne do<input type="date" name="validUntil" /></label></div><button disabled={pending} className="primary-button"><Save size={16} />Zapisz uprawnienie</button></form></article>
        <article className="ops-panel"><h2>Czas pracy</h2><form onSubmit={submit("timesheet", "Czas pracy został zapisany.")} className="ops-form"><label>Pracownik<SelectRows name="employeeId" rows={employees.map((row) => ({ ...row, name: `${row.first_name} ${row.last_name}` }))} placeholder="Wybierz pracownika" required /></label><label>Inwestycja<SelectRows name="projectId" rows={projects} placeholder="Koszt ogólny firmy" /></label><div className="form-row form-row--three"><label>Data<input type="date" name="workDate" defaultValue={today()} /></label><label>Godziny<input name="hours" inputMode="decimal" required /></label><label>Nadgodziny<input name="overtimeHours" inputMode="decimal" /></label></div><button disabled={pending} className="primary-button"><Save size={16} />Zapisz czas</button></form></article>
        <article className="ops-panel"><h2>Wniosek urlopowy</h2><form onSubmit={submit("leave_request", "Wniosek urlopowy trafił do ewidencji.")} className="ops-form"><label>Pracownik<SelectRows name="employeeId" rows={employees.map((row) => ({ ...row, name: `${row.first_name} ${row.last_name}` }))} placeholder="Wybierz pracownika" required /></label><div className="form-row"><label>Od<input type="date" name="dateFrom" required /></label><label>Do<input type="date" name="dateTo" required /></label></div><div className="form-row"><label>Rodzaj<select name="leaveType" defaultValue="annual"><option value="annual">Wypoczynkowy</option><option value="on_demand">Na żądanie</option><option value="unpaid">Bezpłatny</option><option value="sick">Chorobowe</option></select></label><label>Liczba dni<input name="days" inputMode="decimal" required /></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj wniosek</button></form></article>
      </section> : null}
      <section className="ops-panel"><div className="section-heading"><div><p className="eyebrow">Kartoteka pracowników</p><h2>Zatrudnienie, koszty i gotowość</h2></div><span>{employees.length} osób</span></div><div className="employee-register">{employees.map((employee) => { const employment = employments.find((row) => row.employee_id === employee.id); const employeeQualifications = qualifications.filter((row) => row.employee_id === employee.id); const employeeLeaves = leaves.filter((row) => row.employee_id === employee.id); const hours = timesheets.filter((row) => row.employee_id === employee.id).reduce((sum, row) => sum + Number(row.hours ?? 0), 0); return <details key={String(employee.id)}><summary><span className="employee-avatar">{String(employee.first_name).slice(0, 1)}{String(employee.last_name).slice(0, 1)}</span><div><strong>{String(employee.first_name)} {String(employee.last_name)}</strong><small>{String(employment?.position ?? "Bez stanowiska")} · {String(employee.status)}</small></div><b>{number(hours)} h</b></summary><div className="employee-details"><dl><div><dt>Forma</dt><dd>{String(employment?.employment_type ?? "—")}</dd></div><div><dt>Od</dt><dd>{String(employment?.valid_from ?? employee.hired_at ?? "—")}</dd></div><div><dt>Koszt miesięczny</dt><dd>{employment?.monthly_cost ? money(employment.monthly_cost) : "—"}</dd></div><div><dt>Koszt godzinowy</dt><dd>{employment?.hourly_cost ? money(employment.hourly_cost) : "—"}</dd></div></dl><p><strong>Uprawnienia:</strong> {employeeQualifications.length ? employeeQualifications.map((row) => `${row.qualification_type} (${row.valid_until ?? "bezterminowo"})`).join(" · ") : "brak wpisów"}</p><p><strong>Urlopy:</strong> {employeeLeaves.length} wniosków</p><p><strong>Kontakt:</strong> {String(employee.email ?? "—")} · {String(employee.phone ?? "—")}</p></div></details>; })}{!employees.length ? <p className="empty-copy">Dodaj pierwszego pracownika, aby uruchomić kartotekę HR.</p> : null}</div></section>
    </div>;
  }

  if (kind === "warehouse") {
    const warehouses = data.warehouses ?? [];
    const items = data.items ?? [];
    const movements = data.movements ?? [];
    const balances = data.balances ?? [];
    const projects = data.projects ?? [];
    const warehouseNames = new Map(warehouses.map((row) => [String(row.id), String(row.name)]));
    const itemNames = new Map(items.map((row) => [String(row.id), row]));
    const totalValue = movements.reduce((sum, movement) => { const line = (data.lines ?? []).find((row) => row.movement_id === movement.id); return sum + Number(line?.quantity ?? 0) * Number(line?.unit_cost ?? 0); }, 0);
    return <div className="ops-workspace">
      <section className="ops-metrics"><article><Boxes /><span>Magazyny</span><strong>{warehouses.length}</strong><small>Lokalizacje aktywne</small></article><article><Boxes /><span>Kartoteki</span><strong>{items.length}</strong><small>Materiały i narzędzia</small></article><article><ReceiptText /><span>Ruchy zatwierdzone</span><strong>{movements.filter((row) => row.status === "approved").length}</strong><small>PZ/WZ/RW/ZW/MM</small></article><article><WalletCards /><span>Wartość ruchów</span><strong>{money(totalValue)}</strong><small>Według kosztu jednostkowego</small></article></section>
      {readOnly}{feedback}
      {canWrite ? <section className="ops-form-grid">
        <article className="ops-panel"><h2>Dodaj magazyn</h2><form onSubmit={submit("warehouse", "Magazyn został utworzony.")} className="ops-form"><label>Nazwa<input name="name" required /></label><label>Lokalizacja<input name="location" /></label><label>Typ<select name="warehouseType" defaultValue="central"><option value="central">Centralny</option><option value="project">Budowa</option><option value="vehicle">Mobilny / pojazd</option></select></label><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj magazyn</button></form></article>
        <article className="ops-panel"><h2>Dodaj kartotekę</h2><form onSubmit={submit("stock_item", "Kartoteka magazynowa została dodana.")} className="ops-form"><div className="form-row"><label>Nazwa<input name="name" required /></label><label>SKU<input name="sku" /></label></div><div className="form-row form-row--three"><label>Typ<select name="itemType" defaultValue="material"><option value="material">Materiał</option><option value="device">Urządzenie</option><option value="tool">Narzędzie</option></select></label><label>Jednostka<input name="unit" placeholder="szt., m, kg" required /></label><label>Minimum<input name="minimumStock" inputMode="decimal" /></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj kartotekę</button></form></article>
        <article className="ops-panel ops-panel--wide"><h2>Zarejestruj ruch magazynowy</h2><form onSubmit={submit("stock_movement", "Ruch został zatwierdzony i uwzględniony w stanie.")} className="ops-form"><div className="form-row form-row--three"><label>Typ<select name="movementType" defaultValue="PZ"><option>PZ</option><option>WZ</option><option>RW</option><option>ZW</option><option>MM</option></select></label><label>Magazyn<SelectRows name="warehouseId" rows={warehouses} placeholder="Wybierz magazyn" required /></label><label>Magazyn docelowy<SelectRows name="targetWarehouseId" rows={warehouses} placeholder="Tylko dla MM" /></label></div><div className="form-row"><label>Kartoteka<SelectRows name="stockItemId" rows={items} placeholder="Wybierz materiał / sprzęt" required /></label><label>Inwestycja<SelectRows name="projectId" rows={projects} placeholder="Ruch ogólnofirmowy" /></label></div><div className="form-row form-row--three"><label>Ilość<input name="quantity" inputMode="decimal" required /></label><label>Koszt jednostkowy<input name="unitCost" inputMode="decimal" /></label><label>Numer dokumentu<input name="documentNumber" /></label></div><label>Data ruchu<input type="date" name="movementDate" defaultValue={today()} /></label><button disabled={pending} className="primary-button"><Save size={16} />Zatwierdź ruch</button></form></article>
      </section> : null}
      <section className="ops-panel"><div className="section-heading"><div><p className="eyebrow">Stany wyliczone z ruchów</p><h2>Stan według magazynu i kartoteki</h2></div><span>{balances.length} pozycji</span></div><div className="ops-table ops-table--stock"><div className="ops-table__head"><span>Magazyn</span><span>Kartoteka</span><span>SKU</span><span>Ilość</span><span>Jednostka</span></div>{balances.map((balance) => { const item = itemNames.get(String(balance.stockItemId)); return <div key={`${balance.warehouseId}-${balance.stockItemId}`}><strong>{warehouseNames.get(String(balance.warehouseId)) ?? "—"}</strong><span>{String(item?.name ?? "—")}</span><span>{String(item?.sku ?? "—")}</span><span>{number(balance.quantity)}</span><span>{String(item?.unit ?? "—")}</span></div>; })}{!balances.length ? <p className="empty-copy">Dodaj magazyn, kartotekę i pierwszy dokument PZ.</p> : null}</div></section>
    </div>;
  }

  if (kind === "fleet") {
    const vehicles = data.vehicles ?? [];
    const fuel = data.fuel ?? [];
    const service = data.service ?? [];
    const documents = data.documents ?? [];
    const projects = data.projects ?? [];
    const fuelCost = fuel.reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
    const serviceCost = service.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
    const due = documents.filter((row) => row.valid_until && Date.parse(String(row.valid_until)) <= Date.parse(referenceDate) + 30 * 86_400_000).length;
    return <div className="ops-workspace">
      <section className="ops-metrics"><article><CarFront /><span>Pojazdy aktywne</span><strong>{vehicles.filter((row) => row.status === "active").length}</strong><small>Samochody i maszyny</small></article><article><WalletCards /><span>Paliwo</span><strong>{money(fuelCost)}</strong><small>{number(fuel.reduce((sum, row) => sum + Number(row.liters ?? 0), 0))} l</small></article><article><Save /><span>Serwis</span><strong>{money(serviceCost)}</strong><small>{service.filter((row) => row.status === "open").length} otwartych</small></article><article><CalendarClock /><span>Terminy do 30 dni</span><strong>{due}</strong><small>OC, badania i dokumenty</small></article></section>
      {readOnly}{feedback}
      {canWrite ? <section className="ops-form-grid">
        <article className="ops-panel ops-panel--wide"><h2>Dodaj pojazd lub maszynę</h2><form onSubmit={submit("vehicle", "Pojazd został dodany do floty.")} className="ops-form"><div className="form-row form-row--three"><label>Rejestracja<input name="registrationNumber" required /></label><label>Typ<select name="vehicleType" defaultValue="car"><option value="car">Samochód</option><option value="truck">Ciężarówka</option><option value="machine">Maszyna</option><option value="trailer">Przyczepa</option></select></label><label>Forma własności<select name="ownershipType" defaultValue="owned"><option value="owned">Własność</option><option value="lease">Leasing</option><option value="rental">Najem</option></select></label></div><div className="form-row form-row--three"><label>Marka<input name="make" /></label><label>Model<input name="model" /></label><label>Rok<input name="productionYear" inputMode="numeric" /></label></div><div className="form-row"><label>VIN<input name="vin" /></label><label>Przebieg<input name="currentMileage" inputMode="decimal" /></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj pojazd</button></form></article>
        <article className="ops-panel"><h2>Tankowanie</h2><form onSubmit={submit("fuel_entry", "Tankowanie i koszt zostały zapisane.")} className="ops-form"><label>Pojazd<SelectRows name="vehicleId" rows={vehicles} labelKey="registration_number" placeholder="Wybierz pojazd" required /></label><label>Inwestycja<SelectRows name="projectId" rows={projects} placeholder="Koszt ogólny" /></label><div className="form-row"><label>Litry<input name="liters" inputMode="decimal" required /></label><label>Koszt brutto<input name="grossAmount" inputMode="decimal" required /></label></div><div className="form-row"><label>Przebieg<input name="mileage" inputMode="decimal" /></label><label>Data i czas<input type="datetime-local" name="fueledAt" /></label></div><button disabled={pending} className="primary-button"><Save size={16} />Zapisz tankowanie</button></form></article>
        <article className="ops-panel"><h2>Serwis</h2><form onSubmit={submit("service_order", "Zlecenie serwisowe zostało utworzone.")} className="ops-form"><label>Pojazd<SelectRows name="vehicleId" rows={vehicles} labelKey="registration_number" placeholder="Wybierz pojazd" required /></label><label>Rodzaj serwisu<input name="serviceType" required /></label><div className="form-row"><label>Otwarcie<input type="date" name="openedAt" defaultValue={today()} /></label><label>Koszt<input name="cost" inputMode="decimal" /></label></div><div className="form-row"><label>Następna data<input type="date" name="nextDueDate" /></label><label>Następny przebieg<input name="nextDueMileage" inputMode="decimal" /></label></div><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj serwis</button></form></article>
        <article className="ops-panel"><h2>Dokument i termin</h2><form onSubmit={submit("vehicle_document", "Dokument i termin zostały zapisane.")} className="ops-form"><label>Pojazd<SelectRows name="vehicleId" rows={vehicles} labelKey="registration_number" placeholder="Wybierz pojazd" required /></label><label>Rodzaj<select name="documentType" defaultValue="inspection"><option value="inspection">Badanie techniczne</option><option value="insurance">OC / AC</option><option value="lease">Leasing</option><option value="permit">Pozwolenie / UDT</option></select></label><label>Numer<input name="number" /></label><div className="form-row"><label>Od<input type="date" name="validFrom" /></label><label>Ważne do<input type="date" name="validUntil" /></label></div><button disabled={pending} className="primary-button"><Save size={16} />Zapisz dokument</button></form></article>
      </section> : null}
      <section className="ops-panel"><div className="section-heading"><div><p className="eyebrow">Kartoteka floty</p><h2>Koszt, przebieg i terminy</h2></div><span>{vehicles.length} pojazdów</span></div><div className="fleet-register">{vehicles.map((vehicle) => { const vehicleFuel = fuel.filter((row) => row.vehicle_id === vehicle.id); const vehicleService = service.filter((row) => row.vehicle_id === vehicle.id); const vehicleDocs = documents.filter((row) => row.vehicle_id === vehicle.id); return <article key={String(vehicle.id)}><span className="fleet-register__icon"><CarFront size={21} /></span><div><strong>{String(vehicle.registration_number)}</strong><small>{String(vehicle.make ?? "")} {String(vehicle.model ?? "")} · {String(vehicle.vehicle_type)}</small><p>Przebieg: {number(vehicle.current_mileage)} km · paliwo: {money(vehicleFuel.reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0))} · serwis: {money(vehicleService.reduce((sum, row) => sum + Number(row.cost ?? 0), 0))}</p></div><span className="status-chip">{String(vehicle.status)}</span><small>{vehicleDocs.length ? `Najbliższy termin: ${vehicleDocs.map((row) => row.valid_until).filter(Boolean).sort()[0] ?? "—"}` : "Brak terminów"}</small></article>; })}{!vehicles.length ? <p className="empty-copy">Dodaj pierwszy pojazd lub maszynę.</p> : null}</div></section>
    </div>;
  }

  const definitions = data.definitions ?? [];
  const runs = data.runs ?? [];
  const snapshots = data.snapshots ?? [];
  const projects = data.projects ?? [];
  return <div className="ops-workspace">
    <section className="ops-metrics"><article><FileBarChart /><span>Definicje raportów</span><strong>{definitions.length}</strong><small>Stały zakres KPI</small></article><article><Save /><span>Zamknięte snapshoty</span><strong>{snapshots.length}</strong><small>Niezmienna historia</small></article><article><CalendarClock /><span>Uruchomienia</span><strong>{runs.length}</strong><small>Ręczne i cykliczne</small></article><article><AlertTriangle /><span>Błędy</span><strong>{runs.filter((row) => row.status === "error").length}</strong><small>Wymagają reakcji</small></article></section>
    {readOnly}{feedback}
    {canWrite ? <section className="ops-form-grid"><article className="ops-panel"><h2>Nowa definicja raportu</h2><form onSubmit={submit("report_definition", "Definicja raportu została zapisana.")} className="ops-form"><label>Nazwa<input name="name" required /></label><label>Typ<select name="reportType" defaultValue="management"><option value="management">Zarządczy firmy</option><option value="project">Inwestycja</option><option value="finance">Finansowy</option><option value="hr">Kadrowy</option><option value="warehouse">Magazynowy</option><option value="fleet">Flotowy</option></select></label><label>Inwestycja<SelectRows name="projectId" rows={projects} placeholder="Cała firma" /></label><label>Cykl<select name="scheduleRule" defaultValue="manual"><option value="manual">Ręcznie</option><option value="weekly">Tygodniowo</option><option value="monthly">Miesięcznie</option></select></label><button disabled={pending} className="primary-button"><Plus size={16} />Dodaj definicję</button></form></article><article className="ops-panel"><h2>Generuj zamknięty snapshot</h2><form onSubmit={submit("report_generate", "Raport został przeliczony i zamknięty.")} className="ops-form"><label>Definicja<SelectRows name="definitionId" rows={definitions} placeholder="Wybierz raport" required /></label><div className="form-row"><label>Okres od<input type="date" name="periodStart" /></label><label>Okres do<input type="date" name="periodEnd" defaultValue={today()} /></label></div><button disabled={pending || !definitions.length} className="primary-button">{pending ? <LoaderCircle className="spin" size={16} /> : <FileBarChart size={16} />}Generuj raport</button></form></article></section> : null}
    <section className="ops-panel"><div className="section-heading"><div><p className="eyebrow">Historia raportów</p><h2>Zamknięte snapshoty danych</h2></div><span>{snapshots.length} raportów</span></div><div className="report-snapshot-grid">{snapshots.map((snapshot) => { const dataSnapshot = snapshot.data_snapshot as Record<string, Record<string, number>> | undefined; const narrative = snapshot.narrative as Record<string, string> | undefined; return <article key={String(snapshot.id)}><FileBarChart size={21} /><small>{String(snapshot.closed_at ?? snapshot.created_at ?? "")}</small><h3>{narrative?.title ?? "Raport firmy"}</h3><p>{narrative?.summary ?? "Snapshot zatwierdzonych danych operacyjnych."}</p><dl><div><dt>Inwestycje</dt><dd>{dataSnapshot?.portfolio?.projects ?? 0}</dd></div><div><dt>Dokumenty</dt><dd>{dataSnapshot?.portfolio?.documents ?? 0}</dd></div><div><dt>Sprzedaż</dt><dd>{money(dataSnapshot?.finance?.sales_gross)}</dd></div><div><dt>Wynik brutto</dt><dd>{money(dataSnapshot?.finance?.gross_result)}</dd></div></dl></article>; })}{!snapshots.length ? <p className="empty-copy">Dodaj definicję i wygeneruj pierwszy raport.</p> : null}</div></section>
  </div>;
}
