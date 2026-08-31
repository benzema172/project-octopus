"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, FileCheck2 } from "lucide-react";
import styles from "./hr-formal-documents-160.module.css";

type Row = Record<string, unknown>;
type HrData = {
  employees: Row[];
  employments: Row[];
  exams: Row[];
  trainings: Row[];
  qualifications: Row[];
  employeeDocuments: Row[];
  documents: Row[];
};

type Props = {
  workspaceId: string;
  referenceDate: string;
  canWrite: boolean;
  data: HrData;
};

function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}
function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase();
}
function employeeName(row: Row) {
  return `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number, "Pracownik");
}
function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function dateLabel(value: unknown) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}
function isCurrent(row: Row, referenceDate: string) {
  const status = normalize(row.status);
  if (["expired", "archived", "unfit", "rejected", "inactive"].includes(status)) return false;
  return !row.valid_until || String(row.valid_until).slice(0, 10) >= referenceDate;
}
function newest(rows: Row[]) {
  return [...rows].sort((a, b) => String(b.valid_until ?? b.created_at ?? "").localeCompare(String(a.valid_until ?? a.created_at ?? "")))[0];
}

export function HrFormalDocuments162({ referenceDate, canWrite, data }: Props) {
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const activeEmployees = data.employees.filter((row) => row.status === "active");
  const documentById = useMemo(() => new Map(data.documents.map((row) => [String(row.id), row])), [data.documents]);
  const plus30 = addDays(referenceDate, 30);

  const rows = activeEmployees.map((employee) => {
    const employeeId = String(employee.id);
    const employments = data.employments.filter((row) => String(row.employee_id) === employeeId);
    const links = data.employeeDocuments.filter((row) => String(row.employee_id) === employeeId && normalize(row.status) !== "archived");
    const exams = data.exams.filter((row) => String(row.employee_id) === employeeId);
    const trainings = data.trainings.filter((row) => String(row.employee_id) === employeeId);
    const qualifications = data.qualifications.filter((row) => String(row.employee_id) === employeeId);
    const currentExam = newest(exams.filter((row) => isCurrent(row, referenceDate)));
    // Do kompletności formalnej BHP wymagamy daty ważności. Wpis bez terminu pozostaje w historii,
    // ale nie może bezterminowo oznaczać pracownika jako kompletnego.
    const currentTraining = newest(trainings.filter((row) => row.valid_until && isCurrent(row, referenceDate)));
    const contractDocument = links.find((link) => {
      const document = documentById.get(String(link.document_id));
      const haystack = normalize(`${link.document_type ?? ""} ${document?.name ?? ""}`);
      return haystack.includes("umowa") || haystack.includes("contract") || haystack.includes("employment") || haystack.includes("zatrudn");
    });
    const activeEmployment = employments.find((row) => String(row.valid_from ?? "0000-01-01") <= referenceDate && (!row.valid_to || String(row.valid_to) >= referenceDate)) ?? employments[0];
    const expiring = [...exams, ...trainings, ...qualifications].filter((row) => row.valid_until && String(row.valid_until).slice(0, 10) >= referenceDate && String(row.valid_until).slice(0, 10) <= plus30 && normalize(row.status) !== "archived");
    const expired = [...exams, ...trainings, ...qualifications].filter((row) => row.valid_until && String(row.valid_until).slice(0, 10) < referenceDate && normalize(row.status) !== "archived");
    const completeCount = Number(Boolean(contractDocument)) + Number(Boolean(currentExam)) + Number(Boolean(currentTraining));
    return { employee, employeeId, activeEmployment, links, currentExam, currentTraining, contractDocument, qualifications, expiring, expired, completeCount };
  });

  const fullyComplete = rows.filter((row) => row.completeCount === 3).length;
  const missingContracts = rows.filter((row) => !row.contractDocument).length;
  const missingMedical = rows.filter((row) => !row.currentExam).length;
  const missingBhp = rows.filter((row) => !row.currentTraining).length;
  const expiring30 = rows.reduce((sum, row) => sum + row.expiring.length, 0);

  const openUploadForEmployee = (employee: Row) => {
    if (!canWrite) {
      setCompletionMessage("Masz dostęp tylko do odczytu — do uzupełniania akt potrzebne jest uprawnienie zapisu w Kadrach.");
      return;
    }
    const upload = document.querySelector<HTMLElement>('[data-hr-functional-upload="1"]');
    const trigger = upload?.querySelector<HTMLButtonElement>('button[type="button"]');
    if (!upload || !trigger) {
      setCompletionMessage("Nie znaleziono Wrzutni dokumentów. Odśwież zakładkę i spróbuj ponownie.");
      return;
    }
    setCompletionMessage(`Uzupełnianie akt: ${employeeName(employee)}. Wybierz dokument — OCR spróbuje przypisać go automatycznie.`);
    upload.scrollIntoView({ behavior: "smooth", block: "center" });
    // Wywołanie pozostaje w tym samym geście użytkownika, dzięki czemu przeglądarka nie blokuje file pickera.
    trigger.click();
  };

  return <section className={styles.panel} data-hr-formal-documents="2">
    <div className={styles.metrics}>
      <div className={styles.metric}><small>Komplet podstawowy</small><strong>{fullyComplete}/{activeEmployees.length}</strong></div>
      <div className={styles.metric}><small>Brak umowy w aktach</small><strong>{missingContracts}</strong></div>
      <div className={styles.metric}><small>Brak ważnego badania / BHP</small><strong>{missingMedical + missingBhp}</strong></div>
      <div className={styles.metric}><small>Wygasa do 30 dni</small><strong>{expiring30}</strong></div>
    </div>

    {completionMessage ? <div className={styles.hint} role="status"><FileCheck2 size={14} /> {completionMessage}</div> : null}

    <div className={styles.body}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Pracownik</th><th>Umowa / akta</th><th>Badania</th><th>BHP</th><th>Uprawnienia</th><th>Terminy</th><th /></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.employeeId}>
            <td><div className={styles.person}><strong>{employeeName(row.employee)}</strong><span>{str(row.activeEmployment?.position, "Bez stanowiska")} · {str(row.activeEmployment?.employment_type, "forma nieuzupełniona")}</span></div></td>
            <td>{row.contractDocument ? <span className={`${styles.state} ${styles.ok}`}><CheckCircle2 size={12} /> Umowa w aktach · {row.links.length} plików</span> : <span className={`${styles.state} ${styles.bad}`}><CircleAlert size={12} /> Brak dokumentu umowy</span>}</td>
            <td>{row.currentExam ? <span className={`${styles.state} ${styles.ok}`}><CheckCircle2 size={12} /> Ważne do {dateLabel(row.currentExam.valid_until)}</span> : <span className={`${styles.state} ${styles.bad}`}><CircleAlert size={12} /> Brak ważnego badania</span>}</td>
            <td>{row.currentTraining ? <span className={`${styles.state} ${styles.ok}`}><CheckCircle2 size={12} /> Ważne do {dateLabel(row.currentTraining.valid_until)}</span> : <span className={`${styles.state} ${styles.bad}`}><CircleAlert size={12} /> Brak ważnego BHP</span>}</td>
            <td><span className={`${styles.state} ${styles.neutral}`}>{row.qualifications.filter((item) => isCurrent(item, referenceDate)).length} aktywnych</span></td>
            <td>{row.expired.length ? <span className={`${styles.state} ${styles.bad}`}>{row.expired.length} po terminie</span> : row.expiring.length ? <span className={`${styles.state} ${styles.warn}`}>{row.expiring.length} do 30 dni</span> : <span className={`${styles.state} ${styles.ok}`}>Bez pilnych terminów</span>}</td>
            <td><button type="button" className={styles.rowAction} disabled={!canWrite} onClick={() => openUploadForEmployee(row.employee)}>Uzupełnij →</button></td>
          </tr>)}</tbody>
        </table>
        {!rows.length ? <div className={styles.empty}>Brak aktywnych pracowników do kontroli dokumentacji formalnej.</div> : null}
      </div>
    </div>
  </section>;
}
