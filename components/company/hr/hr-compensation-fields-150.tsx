"use client";

import { useMemo, useState } from "react";
import styles from "./hr-workspace-140.module.css";

type Defaults = {
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
  const [net, setNet] = useState(initial(defaults.netMonthlyPay));
  const [gross, setGross] = useState(initial(defaults.grossMonthlyPay));
  const [employer, setEmployer] = useState(initial(defaults.employerContributions, "0"));
  const [other, setOther] = useState(initial(defaults.otherMonthlyCosts, "0"));
  const [hours, setHours] = useState(initial(defaults.nominalMonthlyHours, "168"));
  const totals = useMemo(() => {
    const total = amount(gross) + amount(employer) + amount(other);
    const nominal = amount(hours);
    return { total, hourly: nominal > 0 ? total / nominal : 0 };
  }, [gross, employer, other, hours]);

  return <fieldset className={styles.compensationFields}>
    <legend>Wynagrodzenie i koszt zatrudnienia</legend>
    <p className={styles.fieldHint}>Kwota netto jest informacyjna. Pełny koszt firmy powstaje z brutto, składek pracodawcy i pozostałych kosztów.</p>
    <div className={styles.formGrid}>
      <label>Wypłata netto<input name="netMonthlyPay" inputMode="decimal" value={net} onChange={(event) => setNet(event.target.value)} placeholder="Kwota na rękę" /></label>
      <label>Wynagrodzenie brutto<input name="grossMonthlyPay" inputMode="decimal" value={gross} onChange={(event) => setGross(event.target.value)} placeholder="Kwota brutto" required={requireGross} /></label>
      <label>ZUS / składki pracodawcy<input name="employerContributions" inputMode="decimal" value={employer} onChange={(event) => setEmployer(event.target.value)} /></label>
      <label>Pozostałe koszty<input name="otherMonthlyCosts" inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} placeholder="PPK, dodatki, benefity…" /></label>
      <label>Nominalne godziny miesiąca<input name="nominalMonthlyHours" inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
    </div>
    <div className={styles.costPreview} aria-live="polite">
      <div><small>Pełny koszt pracodawcy</small><strong>{money(totals.total)}</strong></div>
      <div><small>Pełny koszt 1 roboczogodziny</small><strong>{money(totals.hourly)}</strong></div>
    </div>
  </fieldset>;
}
