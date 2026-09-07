import { ToolCase } from "lucide-react";
import type { HrWorkspaceData, HrRow } from "@/lib/hr/types";
import styles from "./hr-issued-equipment-strip-430.module.css";

function employeeName(row?: HrRow) {
  if (!row) return "Pracownik";
  return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() || String(row.employee_number ?? "Pracownik");
}

export function HrIssuedEquipmentStrip430({ data }: { data: HrWorkspaceData }) {
  const active = data.issuedAssets.filter((row) => !row.returned_at && String(row.asset_type) === "stock_instance");
  if (!active.length) return null;

  const employeeById = new Map(data.employees.map((row) => [String(row.id), row]));
  const counts = new Map<string, number>();
  active.forEach((row) => {
    const id = String(row.employee_id ?? "");
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  const preview = [...counts.entries()].slice(0, 4).map(([id, count]) => `${employeeName(employeeById.get(id))}: ${count}`);

  return <section className={styles.strip} aria-label="Sprzęt przypisany pracownikom">
    <ToolCase size={14} aria-hidden="true" />
    <div><strong>Sprzęt na stanie pracowników</strong><span>{preview.join(" · ")}{counts.size > preview.length ? ` · +${counts.size - preview.length} prac.` : ""}</span></div>
    <b>{active.length}</b>
  </section>;
}
