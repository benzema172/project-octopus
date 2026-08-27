"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./hr-dashboard-calendar-146.module.css";

const weekdays = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, Math.max(0, month - 1), day || 1);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function calendarStart(date: Date) {
  const first = startOfMonth(date);
  const mondayOffset = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
}

export function HrDashboardCalendar146({ referenceDate }: { referenceDate: string }) {
  const reference = useMemo(() => parseIso(referenceDate), [referenceDate]);
  const [viewDate, setViewDate] = useState(() => startOfMonth(reference));
  const [selectedDate, setSelectedDate] = useState(referenceDate);

  const days = useMemo(() => {
    const first = calendarStart(viewDate);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return date;
    });
  }, [viewDate]);

  const monthLabel = viewDate.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  const selected = parseIso(selectedDate);
  const selectedLabel = selected.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  return <section className={styles.calendarPanel} aria-label="Miesięczny kalendarz kadr">
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <span className={styles.icon}><CalendarDays size={18} /></span>
        <div>
          <p className={styles.kicker}>Pulpit kadr</p>
          <h2>Kalendarz miesięczny</h2>
          <p>Kliknij dowolny dzień. Kafle są gotowe do dalszego podpięcia zdarzeń kadrowych.</p>
        </div>
      </div>
      <div className={styles.controls}>
        <button type="button" className={styles.iconButton} onClick={() => setViewDate((current) => addMonths(current, -1))} aria-label="Poprzedni miesiąc"><ChevronLeft size={17} /></button>
        <button type="button" className={styles.todayButton} onClick={() => { setViewDate(startOfMonth(reference)); setSelectedDate(referenceDate); }}>Dzisiaj</button>
        <button type="button" className={styles.iconButton} onClick={() => setViewDate((current) => addMonths(current, 1))} aria-label="Następny miesiąc"><ChevronRight size={17} /></button>
      </div>
    </header>

    <div className={styles.monthBar}>
      <strong>{monthLabel}</strong>
      <span>42 dni w dynamicznej siatce</span>
    </div>

    <div className={styles.calendarScroll}>
      <div className={styles.calendarGrid} role="grid" aria-label={monthLabel}>
        {weekdays.map((weekday, index) => <div className={`${styles.weekday} ${index > 4 ? styles.weekendLabel : ""}`} role="columnheader" key={weekday}>{weekday}</div>)}
        {days.map((day) => {
          const value = isoDate(day);
          const currentMonth = day.getMonth() === viewDate.getMonth();
          const isToday = value === referenceDate;
          const isSelected = value === selectedDate;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          return <button
            type="button"
            role="gridcell"
            aria-selected={isSelected}
            aria-label={day.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            className={`${styles.day} ${!currentMonth ? styles.outside : ""} ${isWeekend ? styles.weekend : ""} ${isToday ? styles.today : ""} ${isSelected ? styles.selected : ""}`}
            key={value}
            onClick={() => setSelectedDate(value)}
          >
            <span className={styles.dayNumber}>{day.getDate()}</span>
            <span className={styles.dayBody}>
              {isToday ? <span className={styles.todayChip}>Dziś</span> : <span className={styles.dayHint}>Kliknij dzień</span>}
            </span>
            <span className={styles.dayAccent} aria-hidden="true" />
          </button>;
        })}
      </div>
    </div>

    <footer className={styles.selectionBar}>
      <div>
        <small>Wybrany dzień</small>
        <strong>{selectedLabel}</strong>
      </div>
      <span className={styles.selectionHint}>Gotowy do podpięcia obecności, urlopów, zadań i innych zdarzeń.</span>
    </footer>
  </section>;
}
