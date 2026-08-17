import "server-only";

export type GenerationRunView = {
  id: string;
  created_at: string;
  input_snapshot: Record<string, unknown>;
  warnings: unknown;
  template_versions: unknown;
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function nestedTemplateName(value: unknown) {
  const version = Array.isArray(value) ? value[0] as Record<string, unknown> : value as Record<string, unknown> | null;
  const templates = version?.templates;
  const template = Array.isArray(templates) ? templates[0] as Record<string, unknown> : templates as Record<string, unknown> | null;
  return String(template?.name ?? "Szkic dokumentu");
}

export function generationDocumentCategory(documentType: unknown) {
  const value = String(documentType ?? "document");
  if (value === "material_application") return "application";
  if (value === "progress_report") return "report";
  if (["protocol", "schedule", "report"].includes(value)) return value;
  return "document";
}

export function generationDocumentFileName(run: GenerationRunView) {
  const type = generationDocumentCategory(run.input_snapshot.document_type);
  return `${type}-${run.id.slice(0, 8)}.html`;
}

export function renderGenerationHtml(run: GenerationRunView) {
  const snapshot = run.input_snapshot ?? {};
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts as Array<Record<string, unknown>> : [];
  const boqItems = Array.isArray(snapshot.boq_items) ? snapshot.boq_items as Array<Record<string, unknown>> : [];
  const requirements = Array.isArray(snapshot.requirements) ? snapshot.requirements as Array<Record<string, unknown>> : [];
  const warnings = Array.isArray(run.warnings) ? run.warnings : [];
  const forecast = snapshot.forecast && typeof snapshot.forecast === "object" ? snapshot.forecast as Record<string, unknown> : null;
  const templateName = nestedTemplateName(run.template_versions);
  const factRows = facts.map((fact) => `<tr><th>${escapeHtml(fact.fact_type)}</th><td>${escapeHtml(fact.value_text || JSON.stringify(fact.value_json ?? {}))}</td><td>${escapeHtml(Math.round(Number(fact.confidence ?? 0) * 100))}%</td><td>${fact.source_reference_id ? `Źródło ${escapeHtml(String(fact.source_reference_id).slice(0, 8))}` : "Dane zatwierdzone"}</td></tr>`).join("");
  const boqRows = boqItems.slice(0, 500).map((item) => `<tr><td>${escapeHtml(item.item_number)}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td><td>${escapeHtml(item.total_price ?? "—")}</td></tr>`).join("");

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(templateName)}</title><style>body{font:14px/1.5 Arial,sans-serif;color:#17202c;max-width:900px;margin:40px auto;padding:0 28px}h1{font-size:26px;border-bottom:3px solid #168a68;padding-bottom:12px}h2{margin-top:28px;font-size:18px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #d8dde5;padding:8px;text-align:left;vertical-align:top}small{color:#667085}.warning{background:#fff7e6;border:1px solid #f1d191;padding:10px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.summary div{border:1px solid #d8dde5;border-radius:8px;padding:10px}.summary strong,.summary span{display:block}@media(max-width:700px){.summary{grid-template-columns:1fr}table{font-size:12px}}@media print{body{margin:0}.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">Drukuj / zapisz PDF</button><h1>${escapeHtml(templateName)}</h1><small>Project Octopus · kontrolowany szkic ${escapeHtml(run.id)} · ${escapeHtml(run.created_at)}</small><div class="summary"><div><strong>${facts.length}</strong><span>zatwierdzonych faktów</span></div><div><strong>${boqItems.length}</strong><span>pozycji BOQ</span></div><div><strong>${requirements.length}</strong><span>wymagań</span></div></div><h2>Dane źródłowe</h2><table><thead><tr><th>Typ</th><th>Wartość</th><th>Pewność</th><th>Ślad źródłowy</th></tr></thead><tbody>${factRows || "<tr><td colspan=\"4\">Brak zatwierdzonych faktów</td></tr>"}</tbody></table><h2>Wymagania</h2><ul>${requirements.map((item) => `<li>${escapeHtml(item.title)} — ${escapeHtml(item.status)}</li>`).join("") || "<li>Brak wymagań</li>"}</ul>${boqItems.length ? `<h2>Kosztorys BOQ</h2><table><thead><tr><th>Pozycja</th><th>Opis</th><th>Ilość</th><th>Wartość</th></tr></thead><tbody>${boqRows}</tbody></table>` : ""}${forecast ? `<h2>Prognoza</h2><p>Termin: <strong>${escapeHtml(forecast.forecast_finish_date ?? "—")}</strong> · EAC: <strong>${escapeHtml(forecast.estimate_at_completion ?? "—")}</strong> · marża: <strong>${escapeHtml(forecast.forecast_margin ?? "—")}</strong></p>` : ""}${warnings.length ? `<div class="warning"><strong>Ostrzeżenia:</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}<p><small>Publikacja tego dokumentu wymaga decyzji użytkownika. Zapisana wersja zachowuje snapshot danych użytych podczas generowania.</small></p></body></html>`;
}
