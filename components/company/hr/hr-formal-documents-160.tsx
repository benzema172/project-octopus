"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, FileCheck2, FileText, Sparkles } from "lucide-react";
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
  data: HrData;
};

function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}
function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

export function HrFormalDocuments160({ workspaceId, referenceDate, data }: Props) {
  const activeEmployees = data.employees.filter((row) => row.status === "active");
  const documentById = new Map(data.documents.map((row) => [String(row.id), row]));
  const plus30 = addDays(referenceDate, 30);

  const rows = activeEmployees.map((employee) => {
    const employeeId = String(employee.id);
    const employments = data.employments.filter((row) => String(row.employee_id) === employeeId);
    const links = data.employeeDocuments.filter((row) => String(row.employee_id) === employeeId && normalize(row.status) !== "archived");
    const exams = data.exams.filter((row) => String(row.employee_id) === employeeId);
    const trainings = data.trainings.filter((row) => String(row.employee_id) === employeeId);
    const qualifications = data.qualifications.filter((row) => String(row.employee_id) === employeeId);
    const currentExam = newest(exams.filter((row) => isCurrent(row, referenceDate)));
    const currentTraining = newest(trainings.filter((row) => isCurrent(row, referenceDate)));
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

  const scrollToFormalLink = (employeeId: string) => {
    const root = document.querySelector<HTMLElement>('[data-hr-workspace-slot="employees-shell"]');
    if (!root) return;
    const heading = Array.from(root.querySelectorAll<HTMLElement>("h2,h3,summary"))
      .find((item) => /powiąż dokument|dokument.*pracownik|dokumenty pracownik/i.test(item.textContent ?? ""));
    const section = heading?.closest<HTMLElement>("article,section,details") ?? heading;
    section?.scrollIntoView({ behavior: "smooth", block: "center" });
    const select = section?.querySelector<HTMLSelectElement>('select[name="employeeId"]');
    if (select) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, employeeId);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      window.setTimeout(() => select.focus(), 250);
    }
  };

  return <section className={styles.panel} data-hr-formal-documents="1">
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>Akta pracownika</p>
        <h2>Dokumentacja formalna i kompletność</h2>
        <p>Rejestr wykorzystuje te same dokumenty pracownika, badania, szkolenia BHP i uprawnienia co pozostałe zakładki Kadr. Nie tworzymy kopii danych — tutaj system kontroluje kompletność i terminy.</p>
      </div>
      <div className={styles.links}>
        <Link className={styles.button} href={`/workspace/companies/${workspaceId}/documents`}><FileText size={14} /> Biblioteka</Link>
        <Link className={styles.buttonPrimary} href={`/workspace/companies/${workspaceId}/ai-center`}><Sparkles size={14} /> Wzory i Brain</Link>
      </div>
    </header>

    <div className={styles.metrics}>
      <div className={styles.metric}><small>Komplet podstawowy</small><strong>{fullyComplete}/{activeEmployees.length}</strong></div>
      <div className={styles.metric}><small>Brak umowy w aktach</small><strong>{missingContracts}</strong></div>
      <div className={styles.metric}><small>Brak ważnego badania / BHP</small><strong>{missingMedical + missingBhp}</strong></div>
      <div className={styles.metric}><small>Wygasa do 30 dni</small><strong>{expiring30}</strong></div>
    </div>

    <div className={styles.body}>
      <div className={styles.hint}><FileCheck2 size={14} /> Podstawowa kompletność oznacza: dokument umowy powiązany z pracownikiem + aktualne badanie medyczne + aktualne szkolenie BHP. Uprawnienia branżowe są pokazywane dodatkowo, bo ich wymagany zestaw zależy od stanowiska i wykonywanych robót. Wzory formalne należy utrzymywać w „Wzory i Brain”, gdzie można je wersjonować i zatwierdzać.</div>
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
            <td><button type="button" className={styles.rowAction} onClick={() => scrollToFormalLink(row.employeeId)}>Uzupełnij →</button></td>
          </tr>)}</tbody>
        </table>
        {!rows.length ? <div className={styles.empty}>Brak aktywnych pracowników do kontroli dokumentacji formalnej.</div> : null}
      </div>
    </div>
  </section>;
}
