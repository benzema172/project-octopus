"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Plus, ShieldCheck, X } from "lucide-react";
import { HrCompensationFields150 } from "./hr-compensation-fields-150";
import styles from "./hr-employee-create-153.module.css";

type ApiResponse = {
  id?: string;
  error?: string;
};

type Props = {
  workspaceId: string;
  referenceDate: string;
  canManagePayroll: boolean;
  onClose: () => void;
};

function hasValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function positiveNumber(value: unknown) {
  const parsed = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fieldLabel(name: string) {
  const labels: Record<string, string> = {
    firstName: "Imię",
    lastName: "Nazwisko",
    email: "E-mail",
    operationalNetHourlyRate: "Stawka operacyjna netto / h",
    grossMonthlyPay: "Wynagrodzenie brutto / formalna podstawa brutto"
  };
  return labels[name] ?? "wymagane pole";
}

export function HrEmployeeCreate153({ workspaceId, referenceDate, canManagePayroll, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [partialCreated, setPartialCreated] = useState(false);
  const referenceYear = Number(referenceDate.slice(0, 4));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const postHr = async (action: string, payload: Record<string, unknown>) => {
    const response = await fetch("/api/company/hr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, action, payload })
    });
    const result = await response.json().catch(() => ({})) as ApiResponse;
    if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać danych kadrowych.");
    return result;
  };

  const postCompensationModel = async (employeeId: string, payload: Record<string, FormDataEntryValue>) => {
    const settlementModel = String(payload.settlementModel ?? "monthly");
    const response = await fetch("/api/company/hr/employee-compensation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        employeeId,
        settlementModel,
        operationalNetHourlyRate: payload.operationalNetHourlyRate ?? null
      })
    });
    const result = await response.json().catch(() => ({})) as ApiResponse;
    if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać modelu rozliczenia pracownika.");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (partialCreated || pending) return;

    const form = event.currentTarget;
    setError(null);

    const invalidField = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(":invalid");
    if (invalidField) {
      const message = invalidField.validity.typeMismatch
        ? `Popraw wartość w polu „${fieldLabel(invalidField.name)}”.`
        : `Uzupełnij pole „${fieldLabel(invalidField.name)}”.`;
      setError(message);
      requestAnimationFrame(() => {
        invalidField.focus({ preventScroll: true });
        invalidField.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    const payload = Object.fromEntries(new FormData(form).entries());

    startTransition(async () => {
      let createdEmployeeId: string | null = null;
      try {
        const hybrid = String(payload.settlementModel ?? "monthly") === "hourly_with_monthly_base";
        if (canManagePayroll && hybrid && !positiveNumber(payload.operationalNetHourlyRate)) {
          throw new Error("Model godzinowy: uzupełnij dodatnią stawkę operacyjną netto za godzinę.");
        }
        if (canManagePayroll && hybrid && !hasValue(payload.grossMonthlyPay)) {
          throw new Error("Model godzinowy: uzupełnij formalną podstawę brutto miesięczną.");
        }

        const leaveRequested = hasValue(payload.leaveAnnualDays) || hasValue(payload.leaveCarriedOverDays) || hasValue(payload.leaveExtraDays) || hasValue(payload.leaveNotes);
        if (leaveRequested && !hasValue(payload.leaveAnnualDays)) {
          throw new Error("Dni wolne: uzupełnij podstawowy wymiar urlopu, np. 20 lub 26 dni.");
        }
        const medicalRequested = hasValue(payload.medicalExamType) || hasValue(payload.medicalExaminedAt) || hasValue(payload.medicalValidUntil);
        if (medicalRequested && (!hasValue(payload.medicalExamType) || !hasValue(payload.medicalValidUntil))) {
          throw new Error("Badanie lekarskie: uzupełnij rodzaj badania i datę ważności.");
        }
        const trainingRequested = hasValue(payload.safetyTrainingType) || hasValue(payload.safetyTrainingProvider) || hasValue(payload.safetyTrainingCompletedAt) || hasValue(payload.safetyTrainingValidUntil);
        if (trainingRequested && (!hasValue(payload.safetyTrainingType) || !hasValue(payload.safetyTrainingCompletedAt))) {
          throw new Error("Szkolenie BHP: uzupełnij rodzaj i datę ukończenia.");
        }
        const qualificationRequested = hasValue(payload.qualificationType) || hasValue(payload.qualificationNumber) || hasValue(payload.qualificationIssuedAt) || hasValue(payload.qualificationValidUntil);
        if (qualificationRequested && !hasValue(payload.qualificationType)) {
          throw new Error("Uprawnienie: uzupełnij rodzaj uprawnienia lub certyfikatu.");
        }

        const created = await postHr("employee_create", payload);
        if (!created.id) throw new Error("Pracownik został utworzony bez identyfikatora. Odśwież kartotekę przed ponowną próbą.");
        createdEmployeeId = created.id;

        if (canManagePayroll && hasValue(payload.settlementModel)) {
          await postCompensationModel(created.id, payload);
        }

        const relatedCalls: Array<Promise<ApiResponse>> = [];
        if (leaveRequested) relatedCalls.push(postHr("leave_entitlement_upsert", {
          employeeId: created.id,
          year: referenceYear,
          annualDays: payload.leaveAnnualDays,
          carriedOverDays: payload.leaveCarriedOverDays,
          extraDays: payload.leaveExtraDays,
          notes: payload.leaveNotes
        }));
        if (medicalRequested) relatedCalls.push(postHr("medical_exam_create", {
          employeeId: created.id,
          examType: payload.medicalExamType,
          examinedAt: payload.medicalExaminedAt,
          validUntil: payload.medicalValidUntil,
          result: payload.medicalExamResult || "fit"
        }));
        if (trainingRequested) relatedCalls.push(postHr("safety_training_create", {
          employeeId: created.id,
          trainingType: payload.safetyTrainingType,
          provider: payload.safetyTrainingProvider,
          completedAt: payload.safetyTrainingCompletedAt,
          validUntil: payload.safetyTrainingValidUntil,
          notes: payload.safetyTrainingNotes
        }));
        if (qualificationRequested) relatedCalls.push(postHr("qualification_create", {
          employeeId: created.id,
          qualificationType: payload.qualificationType,
          number: payload.qualificationNumber,
          issuedAt: payload.qualificationIssuedAt,
          validUntil: payload.qualificationValidUntil
        }));
        await Promise.all(relatedCalls);

        router.refresh();
        onClose();
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Nie udało się dodać pracownika.";
        if (createdEmployeeId) {
          setPartialCreated(true);
          setError(`Pracownik został utworzony, ale nie udało się zapisać części danych dodatkowych (model rozliczenia/urlop/BHP/uprawnienia): ${message} Zamknij okno i uzupełnij brakujące dane w kartotece.`);
          router.refresh();
        } else {
          setError(message);
        }
      }
    });
  };

  if (typeof document === "undefined") return null;

  return createPortal(<div className={styles.layer}>
    <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Zamknij dodawanie pracownika" />
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="employee-create-153-title">
      <header className={styles.header}>
        <div><p className={styles.kicker}>Kartoteka pracowników</p><h2 id="employee-create-153-title">Dodaj pracownika</h2></div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Zamknij"><X size={18} /></button>
      </header>
      <div className={styles.body}>
        {error ? <div className={styles.error} role="alert"><AlertTriangle size={16} /> <span>{error}</span></div> : null}
        <form className={styles.form} onSubmit={submit} noValidate>
          <fieldset><legend>Dane pracownika</legend><div className={styles.grid}>
            <label>Imię<input name="firstName" autoFocus required disabled={partialCreated} /></label>
            <label>Nazwisko<input name="lastName" required disabled={partialCreated} /></label>
            <label>Numer pracownika<input name="employeeNumber" disabled={partialCreated} /></label>
            <label>Stanowisko<input name="position" disabled={partialCreated} /></label>
            <label>E-mail<input name="email" type="email" disabled={partialCreated} /></label>
            <label>Telefon<input name="phone" disabled={partialCreated} /></label>
            <label>Forma zatrudnienia<select name="employmentType" defaultValue="employment_contract" disabled={partialCreated}><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label>
            <label>Data zatrudnienia<input name="hiredAt" type="date" defaultValue={referenceDate} disabled={partialCreated} /></label>
            <label>Wymiar etatu<input name="fullTimeEquivalent" inputMode="decimal" placeholder="1,0" disabled={partialCreated} /></label>
            <label>Kontakt awaryjny<input name="emergencyContactName" disabled={partialCreated} /></label>
            <label>Telefon awaryjny<input name="emergencyContactPhone" disabled={partialCreated} /></label>
            <label>Notatka<input name="notes" disabled={partialCreated} /></label>
          </div></fieldset>

          <fieldset><legend><CalendarDays size={15} /> Dni wolne i urlop</legend>
            <p className={styles.hint}>Opcjonalnie ustaw od razu limit na {referenceYear} r. Dane zapiszą się do tej samej ewidencji, którą obsługuje zakładka „Urlopy i absencje”. Jeżeli nie chcesz ustalać limitu teraz, pozostaw wymiar podstawowy pusty.</p>
            <div className={styles.grid}>
              <label>Urlop podstawowy — dni<input name="leaveAnnualDays" inputMode="decimal" placeholder="np. 20 lub 26" disabled={partialCreated} /></label>
              <label>Dni przeniesione z poprzedniego roku<input name="leaveCarriedOverDays" inputMode="decimal" placeholder="0" disabled={partialCreated} /></label>
              <label>Dni dodatkowe<input name="leaveExtraDays" inputMode="decimal" placeholder="0" disabled={partialCreated} /></label>
              <label>Uwagi do limitu<input name="leaveNotes" placeholder="Opcjonalnie" disabled={partialCreated} /></label>
            </div>
          </fieldset>

          {canManagePayroll && !partialCreated ? <HrCompensationFields150 /> : !canManagePayroll ? <p className={styles.hint}>Dane wynagrodzenia i model rozliczenia uzupełni osoba z uprawnieniem Kadry–płace lub Finanse.</p> : null}

          <fieldset><legend><ShieldCheck size={15} /> Badania, BHP i uprawnienia</legend>
            <p className={styles.hint}>Ta sekcja jest opcjonalna. Wpisane dane zapisują się bezpośrednio do centralnej ewidencji i po utworzeniu pracownika będą widoczne w zakładce „Uprawnienia i BHP”. Kolejne badania i szkolenia dodawaj jako nowe wpisy, aby zachować historię.</p>
            <div className={styles.complianceGrid}>
              <section className={styles.complianceBlock}>
                <h3>Badanie lekarskie</h3>
                <label>Rodzaj<select name="medicalExamType" defaultValue="" disabled={partialCreated}><option value="">Nie dodawaj</option><option value="Wstępne">Wstępne</option><option value="Okresowe">Okresowe</option><option value="Kontrolne">Kontrolne</option></select></label>
                <div className={styles.grid}><label>Data badania<input name="medicalExaminedAt" type="date" disabled={partialCreated} /></label><label>Ważne do<input name="medicalValidUntil" type="date" disabled={partialCreated} /></label></div>
                <label>Wynik<select name="medicalExamResult" defaultValue="fit" disabled={partialCreated}><option value="fit">Zdolny</option><option value="fit_with_restrictions">Zdolny z ograniczeniami</option><option value="unfit">Niezdolny</option></select></label>
              </section>
              <section className={styles.complianceBlock}>
                <h3>Szkolenie BHP</h3>
                <label>Rodzaj<select name="safetyTrainingType" defaultValue="" disabled={partialCreated}><option value="">Nie dodawaj</option><option value="Wstępne">Wstępne</option><option value="Okresowe">Okresowe</option><option value="Instruktaż stanowiskowy">Instruktaż stanowiskowy</option></select></label>
                <label>Organizator<input name="safetyTrainingProvider" placeholder="Firma / osoba prowadząca" disabled={partialCreated} /></label>
                <div className={styles.grid}><label>Ukończono<input name="safetyTrainingCompletedAt" type="date" disabled={partialCreated} /></label><label>Ważne do<input name="safetyTrainingValidUntil" type="date" disabled={partialCreated} /></label></div>
                <label>Uwagi<input name="safetyTrainingNotes" disabled={partialCreated} /></label>
              </section>
              <section className={styles.complianceBlock}>
                <h3>Uprawnienie / certyfikat</h3>
                <label>Rodzaj<input name="qualificationType" placeholder="SEP, UDT, F-Gazy, prawo jazdy…" disabled={partialCreated} /></label>
                <label>Numer<input name="qualificationNumber" disabled={partialCreated} /></label>
                <div className={styles.grid}><label>Wydano<input name="qualificationIssuedAt" type="date" disabled={partialCreated} /></label><label>Ważne do<input name="qualificationValidUntil" type="date" disabled={partialCreated} /></label></div>
              </section>
            </div>
          </fieldset>

          <div className={styles.actions}>
            <div className={error ? styles.actionError : styles.actionHint} aria-live="polite">
              {error ? <><AlertTriangle size={14} /><span>{error}</span></> : <span>Imię i nazwisko są wymagane. Pozostałe dane możesz uzupełnić teraz lub później.</span>}
            </div>
            <button type="button" className={styles.secondary} onClick={onClose}>{partialCreated ? "Zamknij" : "Anuluj"}</button>
            {!partialCreated ? <button type="submit" className={styles.primary} disabled={pending}><Plus size={15} /> {pending ? "Dodawanie…" : "Dodaj pracownika"}</button> : null}
          </div>
        </form>
      </div>
    </section>
  </div>, document.body);
}
