"use client";

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Download, Eye, FileText, Printer, Search, X } from "lucide-react";
import styles from "./hr-leaves-161.module.css";

type Row = Record<string, unknown>;

type LeavesData = {
  referenceDate: string;
  year: number;
  employees: Row[];
  employments: Row[];
  leaves: Row[];
  leaveBalances: Row[];
};

type Props = {
  workspaceId: string;
  data: LeavesData;
  canWrite: boolean;
  canApprove: boolean;
};

type ActionResult = { ok?: boolean; id?: string; error?: string; meta?: Record<string, unknown> };

const LEAVE_TYPES: Record<string, string> = {
  annual: "Wypoczynkowy",
  on_demand: "Na żądanie",
  unpaid: "Bezpłatny",
  sick: "Chorobowe",
  care: "Opieka"
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Oczekuje",
  submitted: "Złożony",
  review: "Weryfikacja",
  approved: "Zatwierdzony",
  rejected: "Odrzucony"
};

function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function num(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}

function employeeName(row?: Row) {
  if (!row) return "Pracownik";
  return `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number, "Pracownik");
}

function dateLabel(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  if (!raw) return "—";
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("pl-PL");
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase();
}

function statusLabel(value: unknown) {
  const key = String(value ?? "pending").toLowerCase();
  return STATUS_LABELS[key] ?? str(value, "Oczekuje");
}

function leaveTypeLabel(value: unknown) {
  return LEAVE_TYPES[String(value ?? "annual")] ?? str(value, "Urlop");
}

function statusClass(value: unknown) {
  const key = String(value ?? "").toLowerCase();
  if (key === "approved") return styles.statusOk;
  if (key === "rejected") return styles.statusBad;
  return styles.statusWarn;
}

function activeEmployment(data: LeavesData, employeeId: string) {
  return data.employments
    .filter((row) => String(row.employee_id) === employeeId)
    .filter((row) => String(row.valid_from ?? "0000-01-01") <= data.referenceDate && (!row.valid_to || String(row.valid_to) >= data.referenceDate))
    .sort((a, b) => String(b.valid_from ?? "").localeCompare(String(a.valid_from ?? "")))[0];
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
}

function safeFileName(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "pracownik";
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function jpegToPdf(jpeg: Uint8Array, width: number, height: number) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = new Array<number>(6).fill(0);
  let length = 0;
  const push = (chunk: Uint8Array) => { chunks.push(chunk); length += chunk.length; };
  const text = (value: string) => push(encoder.encode(value));

  text("%PDF-1.4\n%Project-Octopus\n");
  offsets[1] = length;
  text("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = length;
  text("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  offsets[3] = length;
  text("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
  offsets[4] = length;
  text(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  text("\nendstream\nendobj\n");
  const content = "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
  const contentBytes = encoder.encode(content);
  offsets[5] = length;
  text(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  text("endstream\nendobj\n");
  const xrefOffset = length;
  text("xref\n0 6\n0000000000 65535 f \n");
  for (let index = 1; index <= 5; index += 1) text(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return concatBytes(chunks);
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(/\s+/);
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, cursorY);
  return cursorY + lineHeight;
}

function drawPdfCanvas(leave: Row, employee: Row | undefined, position: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Przeglądarka nie pozwoliła przygotować dokumentu PDF.");
  const name = employeeName(employee);
  const type = leaveTypeLabel(leave.leave_type);
  const from = dateLabel(leave.date_from);
  const to = dateLabel(leave.date_to);
  const days = num(leave.days, 0);
  const status = statusLabel(leave.status);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillText("PROJECT OCTOPUS · KADRY", 100, 105);
  ctx.font = "400 18px Arial, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.fillText(`Wygenerowano: ${new Date().toLocaleDateString("pl-PL")}`, 1140, 105);
  ctx.textAlign = "left";
  ctx.strokeStyle = "#d7dce5";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(100, 135); ctx.lineTo(1140, 135); ctx.stroke();

  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.font = "700 48px Arial, sans-serif";
  ctx.fillText("WNIOSEK URLOPOWY", 620, 260);
  ctx.font = "400 20px Arial, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText(`Nr wniosku: ${String(leave.id ?? "—").slice(0, 18)}`, 620, 300);
  ctx.textAlign = "left";

  const field = (label: string, value: string, y: number) => {
    ctx.fillStyle = "#64748b"; ctx.font = "700 17px Arial, sans-serif"; ctx.fillText(label.toUpperCase(), 120, y);
    ctx.fillStyle = "#111827"; ctx.font = "400 27px Arial, sans-serif"; ctx.fillText(value, 120, y + 38);
    ctx.strokeStyle = "#d7dce5"; ctx.beginPath(); ctx.moveTo(120, y + 55); ctx.lineTo(1120, y + 55); ctx.stroke();
  };
  field("Pracownik", name, 390);
  field("Stanowisko", position || "—", 500);

  ctx.fillStyle = "#111827";
  ctx.font = "400 26px Arial, sans-serif";
  let y = 665;
  y = wrapCanvasText(ctx, `Zwracam się z prośbą o udzielenie urlopu w okresie od ${from} do ${to}, w łącznym wymiarze ${days} dni roboczych.`, 120, y, 1000, 39);

  ctx.font = "700 18px Arial, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("RODZAJ NIEOBECNOŚCI", 120, y + 35);
  const options = ["Wypoczynkowy", "Na żądanie", "Bezpłatny", "Chorobowe", "Opieka"];
  let optionX = 120;
  const optionY = y + 82;
  ctx.font = "400 19px Arial, sans-serif";
  for (const option of options) {
    ctx.strokeStyle = "#475569"; ctx.strokeRect(optionX, optionY - 17, 18, 18);
    if (option === type) { ctx.fillStyle = "#111827"; ctx.fillRect(optionX + 4, optionY - 13, 10, 10); }
    ctx.fillStyle = "#111827"; ctx.fillText(option, optionX + 28, optionY);
    optionX += option === "Wypoczynkowy" ? 210 : option === "Na żądanie" ? 180 : 165;
  }

  const decisionY = optionY + 150;
  ctx.fillStyle = "#111827"; ctx.font = "700 24px Arial, sans-serif"; ctx.fillText("Decyzja / status wniosku", 120, decisionY);
  ctx.fillStyle = String(leave.status) === "approved" ? "#166534" : String(leave.status) === "rejected" ? "#991b1b" : "#92400e";
  ctx.font = "700 28px Arial, sans-serif"; ctx.fillText(status, 120, decisionY + 48);
  ctx.strokeStyle = "#d7dce5"; ctx.strokeRect(100, decisionY - 35, 1040, 125);

  const sigY = 1280;
  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath(); ctx.moveTo(120, sigY); ctx.lineTo(480, sigY); ctx.moveTo(760, sigY); ctx.lineTo(1120, sigY); ctx.stroke();
  ctx.fillStyle = "#64748b"; ctx.font = "400 17px Arial, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("data i podpis pracownika", 300, sigY + 30);
  ctx.fillText("akceptacja / podpis przełożonego", 940, sigY + 30);

  ctx.textAlign = "left";
  ctx.strokeStyle = "#d7dce5"; ctx.beginPath(); ctx.moveTo(100, 1550); ctx.lineTo(1140, 1550); ctx.stroke();
  ctx.fillStyle = "#64748b"; ctx.font = "400 16px Arial, sans-serif";
  ctx.fillText("Dokument wygenerowany z modułu Kadry 2.0. Dane wniosku pochodzą z rejestru urlopów Project Octopus.", 100, 1590);
  return canvas;
}

async function downloadPdf(leave: Row, employee: Row | undefined, position: string) {
  const canvas = drawPdfCanvas(leave, employee, position);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  const binary = atob(dataUrl.split(",")[1] ?? "");
  const jpeg = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) jpeg[index] = binary.charCodeAt(index);
  const pdf = jpegToPdf(jpeg, canvas.width, canvas.height);
  const buffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Wniosek_urlopowy_${safeFileName(employeeName(employee))}_${String(leave.date_from ?? "")}_${String(leave.date_to ?? "")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function printRequest(leave: Row, employee: Row | undefined, position: string) {
  const popup = window.open("", "_blank", "width=940,height=1000");
  if (!popup) return;
  popup.opener = null;
  const type = leaveTypeLabel(leave.leave_type);
  const status = statusLabel(leave.status);
  const checked = (label: string) => label === type ? "☒" : "☐";
  popup.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Wniosek urlopowy - ${escapeHtml(employeeName(employee))}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111827;margin:0;background:#fff}.page{width:100%;min-height:260mm;padding:6mm 8mm}.top{display:flex;justify-content:space-between;gap:20px;color:#64748b;font-size:11px;border-bottom:1px solid #d7dce5;padding-bottom:12px}.brand{font-weight:800;color:#111827}.title{text-align:center;margin:52px 0 42px}.title h1{font-size:28px;margin:0 0 8px}.title p{color:#64748b;font-size:11px}.field{margin:0 0 24px}.field small{display:block;color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase;margin-bottom:8px}.field strong{font-size:16px}.line{height:1px;background:#d7dce5;margin-top:10px}.request{font-size:15px;line-height:1.65;margin:42px 0 28px}.types{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;margin:12px 0 38px}.decision{border:1px solid #d7dce5;padding:16px;margin:28px 0 62px}.decision strong{font-size:17px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:88px}.sig{border-top:1px solid #94a3b8;padding-top:8px;text-align:center;color:#64748b;font-size:11px}.foot{margin-top:80px;border-top:1px solid #e5e7eb;padding-top:12px;color:#64748b;font-size:9px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><main class="page"><div class="top"><span class="brand">PROJECT OCTOPUS · KADRY</span><span>Wygenerowano: ${escapeHtml(new Date().toLocaleDateString("pl-PL"))}</span></div><div class="title"><h1>WNIOSEK URLOPOWY</h1><p>Nr wniosku: ${escapeHtml(String(leave.id ?? "—"))}</p></div><div class="field"><small>Pracownik</small><strong>${escapeHtml(employeeName(employee))}</strong><div class="line"></div></div><div class="field"><small>Stanowisko</small><strong>${escapeHtml(position || "—")}</strong><div class="line"></div></div><p class="request">Zwracam się z prośbą o udzielenie urlopu w okresie od <strong>${escapeHtml(dateLabel(leave.date_from))}</strong> do <strong>${escapeHtml(dateLabel(leave.date_to))}</strong>, w łącznym wymiarze <strong>${escapeHtml(num(leave.days, 0))} dni roboczych</strong>.</p><small style="font-weight:800;color:#64748b">RODZAJ NIEOBECNOŚCI</small><div class="types"><span>${checked("Wypoczynkowy")} Wypoczynkowy</span><span>${checked("Na żądanie")} Na żądanie</span><span>${checked("Bezpłatny")} Bezpłatny</span><span>${checked("Chorobowe")} Chorobowe</span><span>${checked("Opieka")} Opieka</span></div><div class="decision"><small style="color:#64748b;font-weight:800">DECYZJA / STATUS</small><div><strong>${escapeHtml(status)}</strong></div></div><div class="signatures"><div class="sig">data i podpis pracownika</div><div class="sig">akceptacja / podpis przełożonego</div></div><div class="foot">Dokument wygenerowany z modułu Kadry 2.0. Dane wniosku pochodzą z rejestru urlopów Project Octopus.</div></main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));<\/script></body></html>`);
  popup.document.close();
}

export function HrLeaves161({ workspaceId, data, canWrite, canApprove }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [previewLeave, setPreviewLeave] = useState<Row | null>(null);
  const [generatedLeave, setGeneratedLeave] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entitlementEmployeeId, setEntitlementEmployeeId] = useState("");
  const [annualDays, setAnnualDays] = useState("");
  const [carriedDays, setCarriedDays] = useState("0");
  const [extraDays, setExtraDays] = useState("0");

  const employeeById = useMemo(() => new Map(data.employees.map((row) => [String(row.id), row])), [data.employees]);
  const balanceByEmployee = useMemo(() => new Map(data.leaveBalances.map((row) => [String(row.employee_id), row])), [data.leaveBalances]);
  const employmentByEmployee = useMemo(() => new Map(data.employees.map((employee) => {
    const id = String(employee.id);
    return [id, activeEmployment(data, id)] as const;
  })), [data]);

  useEffect(() => {
    if (!selectedEmployeeId && data.employees.length === 1) setSelectedEmployeeId(String(data.employees[0].id));
  }, [data.employees, selectedEmployeeId]);

  const employees = useMemo(() => data.employees
    .filter((employee) => !query.trim() || normalize(`${employeeName(employee)} ${employee.employee_number ?? ""} ${employmentByEmployee.get(String(employee.id))?.position ?? ""}`).includes(normalize(query)))
    .sort((a, b) => {
      const activeDiff = Number(b.status === "active") - Number(a.status === "active");
      return activeDiff || employeeName(a).localeCompare(employeeName(b), "pl");
    }), [data.employees, query, employmentByEmployee]);

  const yearRows = useMemo(() => {
    const rows = data.leaves.filter((row) => String(row.date_from ?? "").slice(0, 4) === String(data.year));
    if (generatedLeave && !rows.some((row) => String(row.id) === String(generatedLeave.id)) && String(generatedLeave.date_from ?? "").slice(0, 4) === String(data.year)) rows.push(generatedLeave);
    return rows;
  }, [data.leaves, data.year, generatedLeave]);

  const selectedEmployee = selectedEmployeeId ? employeeById.get(selectedEmployeeId) : undefined;
  const selectedBalance = selectedEmployeeId ? balanceByEmployee.get(selectedEmployeeId) : undefined;
  const selectedEmployment = selectedEmployeeId ? employmentByEmployee.get(selectedEmployeeId) : undefined;
  const selectedRequests = selectedEmployeeId ? yearRows.filter((row) => String(row.employee_id) === selectedEmployeeId).sort((a, b) => String(b.date_from ?? "").localeCompare(String(a.date_from ?? ""))) : [];
  const selectedApproved = selectedRequests.filter((row) => String(row.status) === "approved");
  const selectedTotal = Number(selectedBalance?.annual_days ?? 0) + Number(selectedBalance?.carried_over_days ?? 0) + Number(selectedBalance?.extra_days ?? 0);

  const runAction = async (action: string, payload: Record<string, unknown>) => {
    const response = await fetch("/api/company/hr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, action, payload })
    });
    const result = await response.json().catch(() => ({})) as ActionResult;
    if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać zmian.");
    return result;
  };

  const createLeave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await runAction("leave_create", values);
      const row: Row = {
        id: result.id,
        employee_id: values.employeeId,
        leave_type: values.leaveType,
        date_from: values.dateFrom,
        date_to: values.dateTo,
        days: result.meta?.calculatedDays ?? 0,
        status: "pending",
        created_at: new Date().toISOString()
      };
      setGeneratedLeave(row);
      setSelectedEmployeeId(String(values.employeeId));
      setPreviewLeave(row);
      setMessage(`Wniosek zapisano. Dokument został wygenerowany (${num(result.meta?.calculatedDays, 0)} dni roboczych).`);
      form.reset();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać wniosku urlopowego.");
    } finally { setBusy(false); }
  };

  const selectEntitlementEmployee = (employeeId: string) => {
    setEntitlementEmployeeId(employeeId);
    const balance = balanceByEmployee.get(employeeId);
    setAnnualDays(balance?.entitlement_configured ? String(balance.annual_days ?? "") : "");
    setCarriedDays(balance?.entitlement_configured ? String(balance.carried_over_days ?? 0) : "0");
    setExtraDays(balance?.entitlement_configured ? String(balance.extra_days ?? 0) : "0");
  };

  const saveEntitlement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true); setError(null); setMessage(null);
    try {
      await runAction("leave_entitlement_upsert", values);
      setMessage("Limit urlopowy został zapisany.");
      setSelectedEmployeeId(String(values.employeeId));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać limitu urlopowego.");
    } finally { setBusy(false); }
  };

  const decide = async (leaveId: unknown, decision: "approved" | "rejected") => {
    if (!canApprove || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await runAction("leave_decision", { leaveId, decision });
      setMessage(decision === "approved" ? "Wniosek urlopowy zatwierdzono." : "Wniosek urlopowy odrzucono.");
      if (previewLeave && String(previewLeave.id) === String(leaveId)) setPreviewLeave({ ...previewLeave, status: decision });
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać decyzji.");
    } finally { setBusy(false); }
  };

  const openEmployee = (employeeId: string) => setSelectedEmployeeId((current) => current === employeeId ? null : employeeId);
  const rowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, employeeId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openEmployee(employeeId);
  };

  const previewEmployee = previewLeave ? employeeById.get(String(previewLeave.employee_id)) : undefined;
  const previewPosition = previewLeave ? str(employmentByEmployee.get(String(previewLeave.employee_id))?.position, "") : "";

  return <section className={styles.root} data-hr-leaves-161="1">
    <div className={styles.topGrid}>
      {canWrite ? <article className={styles.panel}>
        <div className={styles.panelHeading}><div><span>Generator dokumentu</span><h2>Nowy wniosek urlopowy</h2></div><FileText size={21} /></div>
        <p className={styles.muted}>Po zapisaniu powstanie gotowy wniosek A4. Liczba dni jest liczona z uwzględnieniem weekendów i świąt ustawowych w Polsce.</p>
        <form className={styles.form} onSubmit={createLeave}>
          <label>Pracownik<select name="employeeId" required defaultValue=""><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
          <label>Rodzaj<select name="leaveType" defaultValue="annual"><option value="annual">Wypoczynkowy</option><option value="on_demand">Na żądanie</option><option value="unpaid">Bezpłatny</option><option value="sick">Chorobowe</option><option value="care">Opieka</option></select></label>
          <div className={styles.formGrid}><label>Od<input name="dateFrom" type="date" required /></label><label>Do<input name="dateTo" type="date" required /></label></div>
          <button className={styles.primaryButton} disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz i wygeneruj wniosek"}</button>
        </form>
      </article> : null}

      {canWrite ? <article className={styles.panel}>
        <div className={styles.panelHeading}><div><span>Roczny wymiar</span><h2>Limit urlopowy {data.year}</h2></div></div>
        <p className={styles.muted}>Wybierz pracownika. Jeżeli limit jest już ustawiony, aktualne wartości zostaną podpowiedziane do edycji.</p>
        <form className={styles.form} onSubmit={saveEntitlement}>
          <label>Pracownik<select name="employeeId" required value={entitlementEmployeeId} onChange={(event) => selectEntitlementEmployee(event.target.value)}><option value="">Wybierz</option>{data.employees.map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
          <input type="hidden" name="year" value={String(data.year)} />
          <div className={styles.formGridThree}><label>Wymiar roczny<input name="annualDays" inputMode="decimal" placeholder="20 / 26 / inny" required value={annualDays} onChange={(event) => setAnnualDays(event.target.value)} /></label><label>Zaległe<input name="carriedOverDays" inputMode="decimal" value={carriedDays} onChange={(event) => setCarriedDays(event.target.value)} /></label><label>Dodatkowe<input name="extraDays" inputMode="decimal" value={extraDays} onChange={(event) => setExtraDays(event.target.value)} /></label></div>
          <button className={styles.secondaryButton} disabled={busy || !entitlementEmployeeId}>Ustaw limit</button>
        </form>
      </article> : null}
    </div>

    {message ? <div className={styles.feedback} role="status"><Check size={16} /> {message}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.feedbackError}`} role="alert"><X size={16} /> {error}</div> : null}

    <article className={styles.registry}>
      <div className={styles.registryHeader}>
        <div><span>Urlopy · {data.year}</span><h2>Pracownicy i urlopy</h2><p>Wybierz pracownika, aby rozwinąć jego bilans, urlopy oraz dokumenty wniosków.</p></div>
        <label className={styles.search}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj pracownika…" /></label>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Pracownik</th><th>Stanowisko</th><th>Limit</th><th>Wykorzystano</th><th>Pozostało</th><th>Wnioski</th><th /></tr></thead>
        <tbody>{employees.map((employee) => {
          const id = String(employee.id);
          const balance = balanceByEmployee.get(id);
          const employment = employmentByEmployee.get(id);
          const requests = yearRows.filter((row) => String(row.employee_id) === id);
          const pendingCount = requests.filter((row) => ["pending", "submitted", "review"].includes(String(row.status))).length;
          const total = Number(balance?.annual_days ?? 0) + Number(balance?.carried_over_days ?? 0) + Number(balance?.extra_days ?? 0);
          const selected = selectedEmployeeId === id;
          return <tr key={id} className={selected ? styles.rowSelected : ""} role="button" tabIndex={0} aria-expanded={selected} onClick={() => openEmployee(id)} onKeyDown={(event) => rowKeyDown(event, id)}>
            <td><strong>{employeeName(employee)}</strong><small>{str(employee.employee_number, employee.status === "active" ? "Aktywny" : str(employee.status))}</small></td>
            <td>{str(employment?.position, "Bez stanowiska")}</td>
            <td>{balance?.entitlement_configured ? `${num(total)} dni` : <span className={styles.missing}>Nie ustawiono</span>}</td>
            <td>{balance?.entitlement_configured ? `${num(balance.used_days)} dni` : "—"}</td>
            <td><strong>{balance?.entitlement_configured ? `${num(balance.remaining_days)} dni` : "—"}</strong></td>
            <td>{requests.length}{pendingCount ? <span className={styles.pendingCount}>{pendingCount} do decyzji</span> : null}</td>
            <td><ChevronDown size={17} className={selected ? styles.chevronOpen : styles.chevron} /></td>
          </tr>;
        })}</tbody>
      </table>{!employees.length ? <div className={styles.empty}>Brak pracowników pasujących do wyszukiwania.</div> : null}</div>
    </article>

    {selectedEmployee ? <article className={styles.employeeDetails}>
      <header className={styles.detailsHeader}><div><span>Karta urlopowa · {data.year}</span><h2>{employeeName(selectedEmployee)}</h2><p>{str(selectedEmployment?.position, "Bez stanowiska")} · {selectedRequests.length} wniosków w roku</p></div><button type="button" className={styles.iconButton} onClick={() => setSelectedEmployeeId(null)} aria-label="Zwiń kartę urlopową"><X size={18} /></button></header>
      <div className={styles.balanceGrid}>
        <div><small>Wymiar łącznie</small><strong>{selectedBalance?.entitlement_configured ? `${num(selectedTotal)} dni` : "—"}</strong><span>roczny + zaległe + dodatkowe</span></div>
        <div><small>Wykorzystano</small><strong>{selectedBalance?.entitlement_configured ? `${num(selectedBalance.used_days)} dni` : "—"}</strong><span>zatwierdzone urlopy</span></div>
        <div><small>Pozostało</small><strong>{selectedBalance?.entitlement_configured ? `${num(selectedBalance.remaining_days)} dni` : "—"}</strong><span>stan na dziś</span></div>
        <div><small>Do decyzji</small><strong>{selectedRequests.filter((row) => ["pending", "submitted", "review"].includes(String(row.status))).length}</strong><span>oczekujące wnioski</span></div>
      </div>

      <div className={styles.detailGrid}>
        <section className={styles.detailSection}><div className={styles.sectionHeading}><div><span>Historia nieobecności</span><h3>Urlopy w {data.year} roku</h3></div><span className={styles.countChip}>{selectedApproved.length}</span></div>
          <div className={styles.compactTableWrap}><table className={styles.compactTable}><thead><tr><th>Termin</th><th>Rodzaj</th><th>Dni</th><th>Status</th></tr></thead><tbody>{selectedApproved.map((leave) => <tr key={String(leave.id)}><td>{dateLabel(leave.date_from)} – {dateLabel(leave.date_to)}</td><td>{leaveTypeLabel(leave.leave_type)}</td><td>{num(leave.days, 0)}</td><td><span className={`${styles.status} ${statusClass(leave.status)}`}>{statusLabel(leave.status)}</span></td></tr>)}</tbody></table>{!selectedApproved.length ? <div className={styles.emptyCompact}>Brak zatwierdzonych urlopów w tym roku.</div> : null}</div>
        </section>

        <section className={styles.detailSection}><div className={styles.sectionHeading}><div><span>Dokumentacja</span><h3>Złożone wnioski urlopowe</h3></div><span className={styles.countChip}>{selectedRequests.length}</span></div>
          <div className={styles.requestList}>{selectedRequests.map((leave) => <div className={styles.requestRow} key={String(leave.id)}>
            <div className={styles.requestMain}><FileText size={18} /><div><strong>{leaveTypeLabel(leave.leave_type)} · {dateLabel(leave.date_from)}–{dateLabel(leave.date_to)}</strong><span>{num(leave.days, 0)} dni · <b className={`${styles.statusText} ${statusClass(leave.status)}`}>{statusLabel(leave.status)}</b></span></div></div>
            <div className={styles.requestActions}>
              <button type="button" title="Podgląd wniosku" onClick={() => setPreviewLeave(leave)}><Eye size={15} /> Podgląd</button>
              <button type="button" title="Pobierz PDF" onClick={() => void downloadPdf(leave, selectedEmployee, str(selectedEmployment?.position, ""))}><Download size={15} /> PDF</button>
              <button type="button" title="Drukuj" onClick={() => printRequest(leave, selectedEmployee, str(selectedEmployment?.position, ""))}><Printer size={15} /> Drukuj</button>
              {canApprove && ["pending", "submitted", "review"].includes(String(leave.status)) ? <><button type="button" className={styles.approve} disabled={busy} onClick={() => void decide(leave.id, "approved")}>Zatwierdź</button><button type="button" className={styles.reject} disabled={busy} onClick={() => void decide(leave.id, "rejected")}>Odrzuć</button></> : null}
            </div>
          </div>)}{!selectedRequests.length ? <div className={styles.emptyCompact}>Nie złożono jeszcze żadnego wniosku w {data.year} roku.</div> : null}</div>
        </section>
      </div>
    </article> : null}

    {previewLeave ? <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-label="Podgląd wniosku urlopowego">
      <button type="button" className={styles.backdrop} onClick={() => setPreviewLeave(null)} aria-label="Zamknij podgląd" />
      <div className={styles.modalShell}>
        <div className={styles.modalToolbar}><div><span>Dokument kadrowy</span><strong>Wniosek urlopowy</strong></div><div className={styles.modalActions}><button type="button" onClick={() => void downloadPdf(previewLeave, previewEmployee, previewPosition)}><Download size={15} /> Pobierz PDF</button><button type="button" onClick={() => printRequest(previewLeave, previewEmployee, previewPosition)}><Printer size={15} /> Drukuj</button><button type="button" className={styles.closeButton} onClick={() => setPreviewLeave(null)} aria-label="Zamknij"><X size={17} /></button></div></div>
        <article className={styles.paper}>
          <div className={styles.paperTop}><strong>PROJECT OCTOPUS · KADRY</strong><span>Wygenerowano: {new Date().toLocaleDateString("pl-PL")}</span></div>
          <header className={styles.paperTitle}><h2>WNIOSEK URLOPOWY</h2><p>Nr wniosku: {str(previewLeave.id)}</p></header>
          <div className={styles.paperField}><small>Pracownik</small><strong>{employeeName(previewEmployee)}</strong></div>
          <div className={styles.paperField}><small>Stanowisko</small><strong>{previewPosition || "—"}</strong></div>
          <p className={styles.paperRequest}>Zwracam się z prośbą o udzielenie urlopu w okresie od <strong>{dateLabel(previewLeave.date_from)}</strong> do <strong>{dateLabel(previewLeave.date_to)}</strong>, w łącznym wymiarze <strong>{num(previewLeave.days, 0)} dni roboczych</strong>.</p>
          <div className={styles.paperTypes}><small>Rodzaj nieobecności</small><div>{Object.values(LEAVE_TYPES).map((label) => <span key={label}><i className={leaveTypeLabel(previewLeave.leave_type) === label ? styles.checkedBox : styles.box} /> {label}</span>)}</div></div>
          <div className={styles.paperDecision}><small>Decyzja / status wniosku</small><strong className={statusClass(previewLeave.status)}>{statusLabel(previewLeave.status)}</strong></div>
          <div className={styles.signatures}><div><span />data i podpis pracownika</div><div><span />akceptacja / podpis przełożonego</div></div>
          <footer>Dokument wygenerowany z modułu Kadry 2.0. Dane wniosku pochodzą z rejestru urlopów Project Octopus.</footer>
        </article>
      </div>
    </div> : null}
  </section>;
}
