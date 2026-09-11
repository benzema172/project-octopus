"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Data, Row } from "@/components/company/operations/module-shell";

const amount = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: number) => new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 2
}).format(value);
const number = (value: number, digits = 0) => new Intl.NumberFormat("pl-PL", {
  maximumFractionDigits: digits
}).format(value);
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pl");

function vehicleName(vehicle: Row) {
  const makeModel = `${String(vehicle.make ?? "").trim()} ${String(vehicle.model ?? "").trim()}`.trim();
  return makeModel || String(vehicle.vehicle_type ?? "Pojazd");
}

function isFuelCost(row: Row) {
  const type = normalize(row.cost_type);
  return type.includes("fuel") || type.includes("paliw");
}

export function FleetCostsSimple({ data }: { data: Data }) {
  const [query, setQuery] = useState("");
  const vehicles = ((data.allVehicles ?? data.vehicles) ?? []) as Row[];
  const costLinks = (data.costLinks ?? []) as Row[];
  const trips = (data.trips ?? []) as Row[];
  const referenceDate = String(data.referenceDate ?? new Date().toISOString().slice(0, 10));
  const monthKey = referenceDate.slice(0, 7);

  const monthLabel = useMemo(() => {
    const date = new Date(`${monthKey}-01T12:00:00`);
    const label = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [monthKey]);

  const monthCosts = useMemo(
    () => costLinks.filter((row) => String(row.occurred_at ?? row.created_at ?? "").slice(0, 7) === monthKey),
    [costLinks, monthKey]
  );
  const monthTrips = useMemo(
    () => trips.filter((row) => String(row.started_at ?? "").slice(0, 7) === monthKey),
    [trips, monthKey]
  );

  const byVehicle = useMemo(() => {
    const map = new Map<string, { total: number; fuel: number; other: number; distance: number }>();
    for (const vehicle of vehicles) {
      map.set(String(vehicle.id), { total: 0, fuel: 0, other: 0, distance: 0 });
    }
    for (const row of monthCosts) {
      const id = String(row.vehicle_id ?? "");
      if (!id) continue;
      const current = map.get(id) ?? { total: 0, fuel: 0, other: 0, distance: 0 };
      const value = amount(row.amount);
      current.total += value;
      if (isFuelCost(row)) current.fuel += value;
      else current.other += value;
      map.set(id, current);
    }
    for (const row of monthTrips) {
      const id = String(row.vehicle_id ?? "");
      if (!id) continue;
      const current = map.get(id) ?? { total: 0, fuel: 0, other: 0, distance: 0 };
      current.distance += amount(row.distance_km);
      map.set(id, current);
    }
    return map;
  }, [vehicles, monthCosts, monthTrips]);

  const monthTotal = monthCosts.reduce((sum, row) => sum + amount(row.amount), 0);
  const fuelTotal = monthCosts.filter(isFuelCost).reduce((sum, row) => sum + amount(row.amount), 0);
  const otherTotal = Math.max(0, monthTotal - fuelTotal);
  const distanceTotal = monthTrips.reduce((sum, row) => sum + amount(row.distance_km), 0);
  const costPerKm = distanceTotal > 0 ? monthTotal / distanceTotal : 0;

  const filteredVehicles = useMemo(() => {
    const needle = normalize(query);
    return [...vehicles]
      .filter((vehicle) => {
        if (!needle) return true;
        const haystack = normalize(`${vehicle.registration_number ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""} ${vehicle.vin ?? ""}`);
        return haystack.includes(needle);
      })
      .sort((a, b) => {
        const aCost = byVehicle.get(String(a.id))?.total ?? 0;
        const bCost = byVehicle.get(String(b.id))?.total ?? 0;
        if (bCost !== aCost) return bCost - aCost;
        return String(a.registration_number ?? "").localeCompare(String(b.registration_number ?? ""), "pl");
      });
  }, [vehicles, byVehicle, query]);

  return <section className="fleet-costs-simple" aria-label="Proste finanse floty">
    <div className="fleet-costs-simple__heading">
      <div>
        <p>FINANSE FLOTY</p>
        <h2>Koszty w prostym ujęciu</h2>
        <span>{monthLabel} · tylko podstawowe informacje potrzebne do kontroli wydatków.</span>
      </div>
    </div>

    <div className="fleet-costs-simple__kpis">
      <article><span>Koszt miesiąca</span><strong>{money(monthTotal)}</strong><small>{monthCosts.length} zapisanych kosztów</small></article>
      <article><span>Paliwo</span><strong>{money(fuelTotal)}</strong><small>{monthTotal > 0 ? `${number((fuelTotal / monthTotal) * 100, 0)}% kosztów miesiąca` : "Brak kosztów paliwa"}</small></article>
      <article><span>Pozostałe koszty</span><strong>{money(otherTotal)}</strong><small>Dokumenty, opłaty i pozostałe wydatki</small></article>
      <article><span>Średni koszt / km</span><strong>{distanceTotal > 0 ? `${money(costPerKm)}/km` : "—"}</strong><small>{number(distanceTotal, 0)} km w miesiącu</small></article>
    </div>

    <div className="fleet-costs-simple__panel">
      <div className="fleet-costs-simple__panel-head">
        <div><span>POJAZDY</span><h3>Koszty wg pojazdu</h3></div>
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj auta…" /></label>
      </div>

      <div className="fleet-costs-simple__table-wrap">
        <div className="fleet-costs-simple__table">
          <div className="fleet-costs-simple__row fleet-costs-simple__row--head">
            <span>Rejestracja</span><span>Pojazd</span><span>Koszt miesiąca</span><span>Paliwo</span><span>Pozostałe</span><span>Dystans</span><span>Koszt / km</span>
          </div>
          {filteredVehicles.map((vehicle) => {
            const stats = byVehicle.get(String(vehicle.id)) ?? { total: 0, fuel: 0, other: 0, distance: 0 };
            return <div className="fleet-costs-simple__row" key={String(vehicle.id)}>
              <span><strong>{String(vehicle.registration_number ?? "—")}</strong></span>
              <span>{vehicleName(vehicle)}</span>
              <span><strong>{money(stats.total)}</strong></span>
              <span>{money(stats.fuel)}</span>
              <span>{money(stats.other)}</span>
              <span>{number(stats.distance, 0)} km</span>
              <span>{stats.distance > 0 ? `${money(stats.total / stats.distance)}/km` : "—"}</span>
            </div>;
          })}
          {!filteredVehicles.length ? <div className="fleet-costs-simple__empty">Brak pojazdów dla bieżącego filtra.</div> : null}
        </div>
      </div>
    </div>

    <style jsx>{`
      .fleet-costs-simple { display: grid; gap: 12px; }
      .fleet-costs-simple__heading { display: flex; justify-content: space-between; align-items: end; gap: 16px; }
      .fleet-costs-simple__heading p,
      .fleet-costs-simple__panel-head > div > span { margin: 0 0 3px; font-size: 10px; font-weight: 800; letter-spacing: .12em; color: #6f7181; }
      .fleet-costs-simple__heading h2 { margin: 0; font-size: 21px; line-height: 1.15; color: #151522; }
      .fleet-costs-simple__heading > div > span { display: block; margin-top: 4px; font-size: 12px; color: #778096; }
      .fleet-costs-simple__kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .fleet-costs-simple__kpis article { min-width: 0; padding: 11px 12px; border: 1px solid #dde2eb; border-radius: 11px; background: #fff; }
      .fleet-costs-simple__kpis span { display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #6f7a91; }
      .fleet-costs-simple__kpis strong { display: block; margin-top: 3px; font-size: 20px; line-height: 1.2; color: #161724; }
      .fleet-costs-simple__kpis small { display: block; margin-top: 2px; font-size: 10px; color: #7a8396; }
      .fleet-costs-simple__panel { overflow: hidden; border: 1px solid #dde2eb; border-radius: 12px; background: #fff; }
      .fleet-costs-simple__panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid #e6e9ef; }
      .fleet-costs-simple__panel-head h3 { margin: 0; font-size: 16px; color: #151522; }
      .fleet-costs-simple__panel-head label { display: flex; align-items: center; gap: 7px; width: min(320px, 100%); padding: 8px 10px; border: 1px solid #dbe0e9; border-radius: 9px; background: #fff; color: #70788b; }
      .fleet-costs-simple__panel-head input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 12px; color: #20222d; }
      .fleet-costs-simple__table-wrap { overflow-x: auto; }
      .fleet-costs-simple__table { min-width: 900px; }
      .fleet-costs-simple__row { display: grid; grid-template-columns: 130px minmax(180px, 1.35fr) repeat(5, minmax(110px, 1fr)); align-items: center; min-height: 44px; border-bottom: 1px solid #edf0f4; }
      .fleet-costs-simple__row:last-child { border-bottom: 0; }
      .fleet-costs-simple__row > span { padding: 8px 11px; font-size: 11px; color: #303443; }
      .fleet-costs-simple__row--head { min-height: 34px; background: #f7f8fb; }
      .fleet-costs-simple__row--head > span { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #697389; }
      .fleet-costs-simple__empty { padding: 28px 14px; text-align: center; font-size: 12px; color: #778096; }
      @media (max-width: 900px) {
        .fleet-costs-simple__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .fleet-costs-simple__panel-head { align-items: stretch; flex-direction: column; }
        .fleet-costs-simple__panel-head label { width: 100%; }
      }
      @media (max-width: 560px) {
        .fleet-costs-simple__kpis { grid-template-columns: 1fr; }
      }
    `}</style>
  </section>;
}
