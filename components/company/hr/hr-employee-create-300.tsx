"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Plus, ShieldCheck, X } from "lucide-react";
import { HrCompensationFields150 } from "./hr-compensation-fields-150";
import styles from "./hr-employee-create-153.module.css";

type Props = { workspaceId: string; referenceDate: string; canManagePayroll: boolean; onClose: () => void };

export function HrEmployeeCreate300({ workspaceId, referenceDate, canManagePayroll, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const referenceYear = Number(referenceDate.slice(0, 4));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [onClose, pending]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid");
    if (invalid) { invalid.focus(); invalid.scrollIntoView({ behavior: "smooth", block: "center" }); setError("Uzupełnij lub popraw wymagane pola formularza."); return; }
    const payload = Object.fromEntries(new FormData(form).entries());
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/hr/employee-bundle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, payload }) });
        const result = await response.json().catch(() => ({})) as { error?: string; id?: string; atomic?: boolean };
        if (!response.ok || !result.id) throw new Error(result.error ?? "Nie udało się utworzyć pracownika.");
        router.refresh();
        onClose();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Nie udało się utworzyć pracownika."); }
    });
  };

  if (typeof document === "undefined") return null;
  return createPortal(<div className={styles.layer} data-hr-atomic-create="300">
    <button type="button" className={styles.backdrop} onClick={() => !pending && onClose()} aria-label="Zamknij dodawanie pracownika" />
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="employee-create-300-title">
      <header className={styles.header}><div><p className={styles.kicker}>Kadry Core 3.0</p><h2 id="employee-create-300-title">Dodaj pracownika</h2><p className={styles.hint}>Cały pakiet zapisuje się atomowo — pracownik, zatrudnienie, urlop, BHP, badania i uprawnienia powstają razem albo nie powstaje nic.</p></div><button type="button" className={styles.iconButton} disabled={pending} onClick={onClose} aria-label="Zamknij"><X size={18} /></button></header>
      <div className={styles.body}>{error ? <div className={styles.error} role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}
        <form className={styles.form} onSubmit={submit} noValidate>
          <fieldset><legend>Dane pracownika i zatrudnienie</legend><div className={styles.grid}>
            <label>Imię<input name="firstName" required autoFocus /></label><label>Nazwisko<input name="lastName" required /></label>
            <label>Numer pracownika<input name="employeeNumber" /></label><label>Stanowisko<input name="position" /></label>
            <label>E-mail<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label>
            <label>Forma zatrudnienia<select name="employmentType" defaultValue="employment_contract"><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label>
            <label>Data zatrudnienia<input name="hiredAt" type="date" defaultValue={referenceDate} /></label>
            <label>Wymiar etatu<input name="fullTimeEquivalent" inputMode="decimal" placeholder="1,0" /></label>
            <label>Kontakt awaryjny<input name="emergencyContactName" /></label><label>Telefon awaryjny<input name="emergencyContactPhone" /></label><label>Notatka<input name="notes" /></label>
          </div></fieldset>

          <fieldset><legend><CalendarDays size={15} /> Limit urlopu {referenceYear}</legend><p className={styles.hint}>Opcjonalnie ustaw limit od razu. Jeżeli wpiszesz dane dodatkowe, podstawowy wymiar musi być uzupełniony.</p><div className={styles.grid}>
            <label>Urlop podstawowy — dni<input name="leaveAnnualDays" inputMode="decimal" placeholder="20 lub 26" /></label><label>Przeniesione<input name="leaveCarriedOverDays" inputMode="decimal" placeholder="0" /></label><label>Dodatkowe<input name="leaveExtraDays" inputMode="decimal" placeholder="0" /></label><label>Uwagi<input name="leaveNotes" /></label>
          </div></fieldset>

          {canManagePayroll ? <HrCompensationFields150 /> : <p className={styles.hint}>Dane wynagrodzenia i koszt pracodawcy może uzupełnić osoba z uprawnieniem Kadry–płace lub Finanse.</p>}

          <fieldset><legend><ShieldCheck size={15} /> Badania, BHP i uprawnienia</legend><p className={styles.hint}>Wpisy są opcjonalne. Kolejne odnowienia zapisuj jako nowe rekordy, aby zachować pełną historię.</p><div className={styles.complianceGrid}>
            <section className={styles.complianceBlock}><h3>Badanie lekarskie</h3><label>Rodzaj<select name="medicalExamType" defaultValue=""><option value="">Nie dodawaj</option><option value="Wstępne">Wstępne</option><option value="Okresowe">Okresowe</option><option value="Kontrolne">Kontrolne</option></select></label><div className={styles.grid}><label>Data badania<input name="medicalExaminedAt" type="date" /></label><label>Ważne do<input name="medicalValidUntil" type="date" /></label></div><label>Wynik<select name="medicalExamResult" defaultValue="fit"><option value="fit">Zdolny</option><option value="fit_with_restrictions">Zdolny z ograniczeniami</option><option value="unfit">Niezdolny</option></select></label></section>
            <section className={styles.complianceBlock}><h3>Szkolenie BHP</h3><label>Rodzaj<select name="safetyTrainingType" defaultValue=""><option value="">Nie dodawaj</option><option value="Wstępne">Wstępne</option><option value="Okresowe">Okresowe</option><option value="Instruktaż stanowiskowy">Instruktaż stanowiskowy</option></select></label><label>Organizator<input name="safetyTrainingProvider" /></label><div className={styles.grid}><label>Ukończono<input name="safetyTrainingCompletedAt" type="date" /></label><label>Ważne do<input name="safetyTrainingValidUntil" type="date" /></label></div><label>Uwagi<input name="safetyTrainingNotes" /></label></section>
            <section className={styles.complianceBlock}><h3>Uprawnienie / certyfikat</h3><label>Rodzaj<input name="qualificationType" placeholder="SEP, UDT, F-Gazy…" /></label><label>Numer<input name="qualificationNumber" /></label><div className={styles.grid}><label>Wydano<input name="qualificationIssuedAt" type="date" /></label><label>Ważne do<input name="qualificationValidUntil" type="date" /></label></div></section>
          </div></fieldset>

          <div className={styles.actions}><button type="button" onClick={onClose} disabled={pending}>Anuluj</button><button disabled={pending}><Plus size={15} /> {pending ? "Zapisywanie całego pakietu…" : "Dodaj pracownika"}</button></div>
        </form>
      </div>
    </section>
  </div>, document.body);
}
