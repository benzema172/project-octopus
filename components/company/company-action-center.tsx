import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleAlert } from "lucide-react";
import type { CompanyActionItem } from "@/lib/data/company-action-center";

function severityLabel(value: string) {
  if (value === "critical") return "Krytyczne";
  if (value === "high" || value === "warning") return "Wymaga uwagi";
  return "Do zaplanowania";
}

function formatDue(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatAmount(value: number | null) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.01) return null;
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(value);
}

export function CompanyActionCenter({ items }: { items: CompanyActionItem[] }) {
  const critical = items.filter((item) => item.severity === "critical").length;
  const warnings = items.filter((item) => item.severity === "warning" || item.severity === "high").length;
  const visible = items.slice(0, 12);

  return (
    <section className="co-section" aria-labelledby="company-action-center-heading">
      <div className="co-section-heading">
        <div>
          <p className="co-kicker">Wymaga uwagi</p>
          <h2 id="company-action-center-heading">Jedna kolejka pracy całej firmy</h2>
          <p>Octopus zbiera wyjątki z finansów, dokumentów, magazynu, kadr, floty i inwestycji. Kliknięcie prowadzi bezpośrednio do miejsca działania.</p>
        </div>
        <div className="co-company-address">
          <strong>{items.length} aktywnych</strong>
          <span>{critical} krytycznych · {warnings} ostrzeżeń</span>
        </div>
      </div>

      {!visible.length ? (
        <div className="co-empty-state">
          <CheckCircle2 size={22} aria-hidden="true" />
          <strong>Brak aktywnych wyjątków.</strong>
          <p>Na podstawie aktualnych danych nie ma teraz spraw wymagających interwencji.</p>
        </div>
      ) : (
        <div className="co-project-strip" aria-label="Aktywne wyjątki operacyjne">
          {visible.map((item) => {
            const due = formatDue(item.dueAt);
            const amount = formatAmount(item.amount);
            const Icon = item.severity === "critical" ? CircleAlert : item.dueAt ? CalendarClock : AlertTriangle;
            const content = (
              <>
                <span className="status-chip"><Icon size={13} aria-hidden="true" /> {severityLabel(item.severity)} · {item.domain}</span>
                <strong>{item.title}</strong>
                <small>{item.detail || "Otwórz moduł i wykonaj wymagane działanie."}</small>
                {due || amount ? <small>{due ? `Termin: ${due}` : ""}{due && amount ? " · " : ""}{amount ?? ""}</small> : null}
              </>
            );
            return item.href ? <Link href={item.href} key={item.itemKey}>{content}</Link> : <article key={item.itemKey}>{content}</article>;
          })}
        </div>
      )}
    </section>
  );
}
