export const PROJECT_OPERATIONAL_STATUSES = ["preparation", "active"] as const;
export const PROJECT_READ_ONLY_STATUSES = ["completed", "archived"] as const;

export function isProjectOperationalStatus(value: unknown) {
  return PROJECT_OPERATIONAL_STATUSES.includes(String(value ?? "") as (typeof PROJECT_OPERATIONAL_STATUSES)[number]);
}

export function isProjectReadOnlyStatus(value: unknown) {
  return PROJECT_READ_ONLY_STATUSES.includes(String(value ?? "") as (typeof PROJECT_READ_ONLY_STATUSES)[number]);
}

export function projectLifecycleLabel(value: unknown) {
  const status = String(value ?? "");
  if (status === "archived") return "Archiwalna";
  if (status === "completed") return "Zakończona";
  if (status === "paused") return "Wstrzymana";
  if (status === "preparation") return "Przygotowanie";
  if (status === "active") return "Aktywna";
  if (status === "tender") return "Przetarg";
  return status || "Nieznany status";
}
