"use client";

import { useMemo, useState } from "react";
import styles from "./hr-workspace-140.module.css";

type SettlementModel = "monthly" | "hourly_with_monthly_base";

type Defaults = {
  settlementModel?: unknown;
  operationalNetHourlyRate?: unknown;
  netMonthlyPay?: unknown;
  grossMonthlyPay?: unknown;
  employerContributions?: unknown;
  otherMonthlyCosts?: unknown;
  nominalMonthlyHours?: unknown;
};

function initial(value: unknown, fallback = "") {
  return value === null || value === undefined || value === "" ? fallback : String(value).replace(".", ",");
}

function amount(value: string) {
  const parsed = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(value);
}

export function HrCompensationFields150({ defaults = {}, requireGross = false }: { defaults?: Defaults; requireGross?: boolean }) {
  const initialModel = String(defaults.settlementModel ?? "monthly") === "hourly_with_monthly_base" ? "hourly_with_monthly_base" : "monthly";
  const [model, setModel] = useState<SettlementModel>(initialModel);
  const [operationalHourly, setOperationalHourly] = useState(initial(defaults.operationalNetHourlyRate));
  const [net, setNet] = useState(initial(defaults.netMonthlyPay));
  const [gross, setGross] = useState(initial(defaults.grossMonthlyPay));
  const [employer, setEmployer] = useState(initial(defaults.employerContributions, "0"));
  const [other, setOther] = useState(initial(defaults.otherMonthlyCosts, "0"));
  const [hours, setHours] = useState(initial(defaults.nominalMonthlyHours, "168"));
  const totals = useMemo(() => {
    const total = amount(gross) + amount(employer) + amount(other);
    const nominal = amount(hours);
    return { total, formalHourly: nominal > 0 ? total / nominal : 0, operationalHourly: amount(operationalHourly) };
  }, [gross, employer, other, hours, operationalHourly]);

  const hybrid = model === "hourly_with_monthly_base";

  return <fieldset className={styles.compensationFields}>
    <legend>Wynagrodzenie i model rozliczenia</legend>
    <p className={styles.fieldHint}>Model miesięczny rozlicza koszt inwestycji z pełnego kosztu zatrudnienia na godzinę. Model godzinowy z podstawą miesięczną rozlicza inwestycje dokładnie według stawki operacyjnej netto/h, a dane umowne pozostają osobno w aktach kadrowych.</p>
    <div className={styles.formGrid}>
      <label>Sposób rozliczania<select name="settlementModel" value={model} onChange={(event) => setModel(event.target.value as SettlementModel)}><option value="monthly">Stała pensja miesięczna</option><option value="hourly_with_monthly_base">Godzinowo + formalna podstawa miesięczna</option></select></label>
      {hybrid ? <label>Stawka operacyjna netto / h<input name="operationalNetHourlyRate" inputMode="decimal" value={operationalHourly} onChange={(event) => setOperationalHourly(event.target.value)} placeholder="np. 30,00" required /></label> : null}
      <label>{hybrid ? "Formalna podstawa netto miesięczna" : "Wypłata netto miesięczna"}<input name="netMonthlyPay" inputMode="decimal" value={net} onChange={(event) => setNet(event.target.value)} placeholder={hybrid ? "Kwota z warunków zatrudnienia" : "Kwota na rękę"} /></label>
      <label>{hybrid ? "Formalna podstawa brutto miesięczna" : "Wynagrodzenie brutto"}<input name="grossMonthlyPay" inputMode="decimal" value={gross} onChange={(event) => setGross(event.target.value)} placeholder="Kwota brutto" required={requireGross || hybrid} /></label>
      <label>ZUS / składki pracodawcy<input name="employerContributions" inputMode="decimal" value={employer} onChange={(event) => setEmployer(event.target.value)} /></label>
      <label>Pozostałe formalne koszty<input name="otherMonthlyCosts" inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} placeholder="PPK, dodatki, benefity…" /></label>
      <label>Nominalne godziny miesiąca<input name="nominalMonthlyHours" inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
    </div>
    <div className={styles.costPreview} aria-live="polite">
      {hybrid ? <div><small>Stawka używana w inwestycjach</small><strong>{money(totals.operationalHourly)} / h</strong></div> : null}
      <div><small>Formalny miesięczny koszt pracodawcy</small><strong>{money(totals.total)}</strong></div>
      <div><small>Formalny koszt 1 r-g</small><strong>{money(totals.formalHourly)}</strong></div>
    </div>
    {hybrid ? <p className={styles.fieldHint}>Zatwierdzony czas pracy będzie obciążał inwestycje według stawki operacyjnej netto/h. Formalna podstawa brutto, ZUS i pozostałe koszty pozostają w Kadrach i nie zmieniają kosztu godzinowego inwestycji.</p> : null}
  </fieldset>;
}
