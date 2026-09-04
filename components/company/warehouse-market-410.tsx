"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BrainCircuit, RotateCcw } from "lucide-react";
import { WarehouseWorkspace300 } from "@/components/company/warehouse-workspace-300";
import workspaceStyles from "./warehouse-workspace-310.module.css";
import panelStyles from "./warehouse-market-400.module.css";
import styles from "./warehouse-market-410.module.css";

type Props = ComponentProps<typeof WarehouseWorkspace300>;
type Row = Record<string, unknown>;

type MarketResult = {
  error?: string;
  result?: { requiresHumanApproval?: boolean };
};

const text = (value: unknown, fallback = "—") =>
  value === null || value === undefined || value === "" ? fallback : String(value);

const number = (value: unknown, digits = 1) =>
  new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0) || 0);

const itemLabel = (row: Row) => `${text(row.name)}${row.sku ? ` · ${text(row.sku)}` : ""}`;
const projectLabel = (row: Row) => text(row.name);

const statusTone = (value: unknown) => {
  const status = String(value);
  if (["available", "active", "done", "delivered", "approved", "ready", "executed", "accepted"].includes(status)) {
    return panelStyles.good;
  }
  if (["blocked", "critical", "error", "expired", "rejected", "exception", "dismissed"].includes(status)) {
    return panelStyles.bad;
  }
  return panelStyles.warn;
};

function Badge({ children, tone = panelStyles.badge }: { children: ReactNode; tone?: string }) {
  return <span className={tone}>{children}</span>;
}

function Panel({
  title,
  kicker,
  children,
  wide = false
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`${panelStyles.panel} ${wide ? panelStyles.wide : ""}`}>
      <div className={panelStyles.head}>
        {kicker ? <small>{kicker}</small> : null}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function WarehouseMarket410(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planningActive, setPlanningActive] = useState(false);
  const [tabHost, setTabHost] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = props.data as Record<string, unknown>;
  const items = ((data.warehousePlanningItems ?? data.catalogItems ?? data.items) ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const forecasts = (data.warehouseForecasts400 ?? []) as Row[];
  const readiness = (data.materialReadiness400 ?? []) as Row[];
  const recommendations = (data.warehouseAiRecommendations400 ?? []) as Row[];

  const projectById = useMemo(
    () => new Map(projects.map((row) => [String(row.id), row])),
    [projects]
  );

  const latestReadiness = useMemo(() => {
    const byProject = new Map<string, Row>();
    readiness.forEach((row) => {
      const id = String(row.project_id ?? "");
      if (id && !byProject.has(id)) byProject.set(id, row);
    });
    return [...byProject.values()];
  }, [readiness]);

  useEffect(() => {
    let frame = 0;
    let host: HTMLElement | null = null;

    const attach = () => {
      host = document.querySelector<HTMLElement>('nav[aria-label="Sekcje Magazynu 3.1"]');
      if (!host) {
        frame = window.requestAnimationFrame(attach);
        return;
      }
      setTabHost(host);
    };

    attach();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!tabHost) return;

    const handleTabClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (target && !target.hasAttribute("data-warehouse-planning-tab")) {
        setPlanningActive(false);
      }
    };

    tabHost.addEventListener("click", handleTabClick);
    return () => tabHost.removeEventListener("click", handleTabClick);
  }, [tabHost]);

  const run = (action: string, payload: Record<string, unknown>, success = "Operacja została wykonana.") => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/warehouse-market", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: props.workspaceId, action, payload })
        });
        const output = (await response.json().catch(() => ({}))) as MarketResult;
        if (!response.ok) throw new Error(output.error ?? "Operacja Planowania AI nie powiodła się.");

        setMessage(
          output.result?.requiresHumanApproval
            ? "Utworzono wyłącznie szkic zamówienia. Oczekuje na zatwierdzenie człowieka."
            : success
        );
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Operacja Planowania AI nie powiodła się.");
      }
    });
  };

  const submitPlanning = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      "item_planning_update",
      Object.fromEntries(new FormData(event.currentTarget).entries()),
      "Zapisano strategię planowania kartoteki."
    );
  };

  return (
    <div
      className={`${styles.shell} ${planningActive ? styles.planningActive : ""}`}
      data-warehouse-experience="4.1"
    >
      <WarehouseWorkspace300 {...props} />

      {tabHost
        ? createPortal(
            <button
              type="button"
              data-warehouse-planning-tab=""
              className={`${workspaceStyles.tab} ${planningActive ? workspaceStyles.tabActive : ""}`}
              aria-pressed={planningActive}
              onClick={() => setPlanningActive(true)}
            >
              <BrainCircuit size={15} />
              Planowanie AI
            </button>,
            tabHost
          )
        : null}

      {planningActive ? (
        <div className={styles.planningContent}>
          {message ? <div className={`${panelStyles.feedback} ${panelStyles.success}`}>{message}</div> : null}
          {error ? <div className={`${panelStyles.feedback} ${panelStyles.error}`}>{error}</div> : null}

          <div className={panelStyles.grid}>
            <Panel
              title="AI Material Planner"
              kicker="ABC/XYZ · forecast · min/max · Project Material Readiness"
              wide
            >
              <div className={panelStyles.guard}>
                <strong>Guardrail zakupowy.</strong>
                <span>
                  Autonomous Replenishment nie wysyła zamówienia do dostawcy. Może utworzyć wyłącznie szkic PO,
                  który wymaga osobnego zatwierdzenia człowieka.
                </span>
              </div>
              {props.canWrite ? (
                <button
                  type="button"
                  className={panelStyles.primary}
                  disabled={pending}
                  onClick={() => run("refresh_intelligence", {}, "Przeliczono Digital Worker Magazynu.")}
                >
                  <RotateCcw size={14} />
                  {pending ? "Przeliczanie…" : "Przelicz Digital Worker"}
                </button>
              ) : null}
              <div className={panelStyles.readiness}>
                {latestReadiness.slice(0, 20).map((row) => (
                  <div className={panelStyles.card} key={String(row.id)}>
                    <h3>{projectLabel(projectById.get(String(row.project_id)) ?? {})}</h3>
                    <strong>{number(row.score)}%</strong>
                    <p>
                      {text(row.ready_lines, "0")}/{text(row.required_lines, "0")} pozycji gotowych · braki{" "}
                      {text(row.shortage_lines, "0")}
                    </p>
                  </div>
                ))}
                {latestReadiness.length === 0 ? <p className={styles.empty}>Brak wyliczonej gotowości materiałowej.</p> : null}
              </div>
            </Panel>

            <Panel title="Rekomendacje AI" kicker="Sygnał ≠ automatyczna decyzja">
              <div className={panelStyles.cards}>
                {recommendations.slice(0, 30).map((row) => {
                  const payload =
                    row.action_payload && typeof row.action_payload === "object"
                      ? (row.action_payload as Row)
                      : {};
                  const stockItemId = text(payload.stockItemId ?? row.stock_item_id, "");
                  return (
                    <div className={panelStyles.card} key={String(row.id)}>
                      <h3>{text(row.title)}</h3>
                      <p>{text(row.description)}</p>
                      <p>
                        <Badge tone={statusTone(row.severity)}>{text(row.severity)}</Badge> ·{" "}
                        {text(row.recommendation_type)}
                      </p>
                      <div className={panelStyles.actions}>
                        {props.canApprove && String(row.status) === "new" ? (
                          <>
                            <button
                              type="button"
                              className={panelStyles.secondary}
                              disabled={pending}
                              onClick={() =>
                                run(
                                  "recommendation_status",
                                  { recommendationId: row.id, status: "accepted" },
                                  "Zaakceptowano rekomendację AI."
                                )
                              }
                            >
                              Akceptuj sygnał
                            </button>
                            <button
                              type="button"
                              className={panelStyles.secondary}
                              disabled={pending}
                              onClick={() =>
                                run(
                                  "recommendation_status",
                                  { recommendationId: row.id, status: "dismissed" },
                                  "Odrzucono rekomendację AI."
                                )
                              }
                            >
                              Odrzuć
                            </button>
                          </>
                        ) : null}
                        {props.canApprove && stockItemId && String(row.recommendation_type) === "shortage" ? (
                          <button
                            type="button"
                            className={panelStyles.primary}
                            disabled={pending}
                            onClick={() =>
                              run(
                                "autonomous_replenishment",
                                { stockItemId },
                                "Utworzono szkic zamówienia zakupowego."
                              )
                            }
                          >
                            Utwórz szkic PO
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {recommendations.length === 0 ? <p className={styles.empty}>Brak nowych rekomendacji AI.</p> : null}
              </div>
            </Panel>

            <Panel title="Strategia kartotek" kicker="FIFO / FEFO / LIFO + polityka zamawiania">
              {props.canWrite ? (
                <details className={panelStyles.form}>
                  <summary>Zmień planowanie kartoteki</summary>
                  <form onSubmit={submitPlanning}>
                    <div className={panelStyles.fields}>
                      <label>
                        <span>Kartoteka</span>
                        <select name="stockItemId" required defaultValue="">
                          <option value="">Wybierz</option>
                          {items.map((row) => (
                            <option key={String(row.id)} value={String(row.id)}>
                              {itemLabel(row)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Rotacja</span>
                        <select name="stockStrategy" defaultValue="">
                          <option value="">Bez zmiany</option>
                          <option value="fifo">FIFO</option>
                          <option value="fefo">FEFO</option>
                          <option value="lifo">LIFO</option>
                        </select>
                      </label>
                      <label>
                        <span>Polityka</span>
                        <select name="reorderPolicy" defaultValue="">
                          <option value="">Bez zmiany</option>
                          <option value="manual">Ręczna</option>
                          <option value="minmax">Min/Max</option>
                          <option value="forecast">Prognoza</option>
                          <option value="project_demand">Popyt inwestycji</option>
                        </select>
                      </label>
                      <label><span>Lead time [dni]</span><input name="leadTimeDays" type="number" step="any" /></label>
                      <label><span>Service level %</span><input name="serviceLevelPct" type="number" step="any" /></label>
                      <label><span>Min dynamiczny</span><input name="dynamicMinStock" type="number" step="any" /></label>
                      <label><span>Max dynamiczny</span><input name="dynamicMaxStock" type="number" step="any" /></label>
                      <label><span>Shelf-life [dni]</span><input name="shelfLifeDays" type="number" step="any" /></label>
                      <label><span>GTIN</span><input name="gtin" type="text" /></label>
                      <label>
                        <span>Śledź LOT</span>
                        <select name="lotTracking" defaultValue=""><option value="">Bez zmiany</option><option value="true">Tak</option><option value="false">Nie</option></select>
                      </label>
                      <label>
                        <span>Śledź ważność</span>
                        <select name="expiryTracking" defaultValue=""><option value="">Bez zmiany</option><option value="true">Tak</option><option value="false">Nie</option></select>
                      </label>
                      <label>
                        <span>GS1</span>
                        <select name="gs1Enabled" defaultValue=""><option value="">Bez zmiany</option><option value="true">Tak</option><option value="false">Nie</option></select>
                      </label>
                    </div>
                    <button className={panelStyles.primary} disabled={pending}>
                      {pending ? "Zapisywanie…" : "Zapisz"}
                    </button>
                  </form>
                </details>
              ) : null}

              <div className={panelStyles.table}>
                <table>
                  <thead>
                    <tr><th>Kartoteka</th><th>ABC/XYZ</th><th>Strategia</th><th>Min/Max</th><th>Prognoza</th></tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 50).map((row) => {
                      const forecast = forecasts.find(
                        (entry) => String(entry.stock_item_id) === String(row.id)
                      );
                      return (
                        <tr key={String(row.id)}>
                          <td>{itemLabel(row)}</td>
                          <td>{text(row.abc_class)}/{text(row.xyz_class)}</td>
                          <td>{text(row.stock_strategy)} · {text(row.reorder_policy)}</td>
                          <td>{number(row.dynamic_min_stock)} / {number(row.dynamic_max_stock)}</td>
                          <td>{forecast ? number(forecast.forecast_quantity) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
