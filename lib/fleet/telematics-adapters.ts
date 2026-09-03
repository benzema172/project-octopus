import "server-only";

export type FleetProvider = "generic" | "webfleet" | "geotab" | "samsara" | "motive" | "cartrack" | "navifleet" | "oem" | "obd" | "can" | "etoll" | "tachograph" | "sent" | "other";
export type FleetEventType = "position" | "diagnostic" | "behavior" | "camera" | "charge" | "fuel" | "regulatory";

export type NormalizedFleetEvent = {
  type: FleetEventType;
  sourceEventId: string;
  externalDeviceId: string;
  externalVehicleId: string;
  capturedAt: string;
  employeeExternalId?: string;
  position?: {
    latitude: number;
    longitude: number;
    speedKph?: number;
    heading?: number;
    altitudeM?: number;
    ignition?: boolean;
    odometerKm?: number;
    engineHours?: number;
    fuelLevelPct?: number;
    batterySocPct?: number;
    batteryVoltage?: number;
    accuracyM?: number;
    locationLabel?: string;
  };
  diagnostic?: { code: string; system?: string; severity: "info" | "warning" | "critical"; description?: string; state: "active" | "cleared" | "historic"; odometerKm?: number; engineHours?: number; freezeFrame?: Record<string, unknown> };
  behavior?: { eventType: string; severity: "info" | "warning" | "critical"; value?: number; unit?: string; latitude?: number; longitude?: number; scoreDelta: number; metadata?: Record<string, unknown> };
  camera?: { eventType: string; severity: "info" | "warning" | "critical"; aiSummary?: string; aiConfidence?: number; mediaUrl?: string; metadata?: Record<string, unknown> };
  charge?: { startedAt: string; endedAt?: string; location?: string; latitude?: number; longitude?: number; energyKwh: number; grossAmount?: number; currency?: string; startSocPct?: number; endSocPct?: number; chargerPowerKw?: number; providerName?: string; projectExternalId?: string; metadata?: Record<string, unknown> };
  fuel?: { fueledAt: string; liters: number; grossAmount: number; currency?: string; mileage?: number; fuelType?: string; stationName?: string; latitude?: number; longitude?: number; transactionId?: string; projectExternalId?: string; employeeExternalId?: string };
  regulatory?: { eventType: string; status: "ok" | "warning" | "violation" | "pending"; referenceNumber?: string; details?: Record<string, unknown> };
  raw: Record<string, unknown>;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown) => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
const finite = (value: unknown) => { const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : undefined; };
const boolean = (value: unknown) => typeof value === "boolean" ? value : ["1","true","on","yes","ignition_on"].includes(string(value).toLowerCase()) ? true : ["0","false","off","no","ignition_off"].includes(string(value).toLowerCase()) ? false : undefined;
const severity = (value: unknown): "info" | "warning" | "critical" => ["critical","high","danger","severe"].includes(string(value).toLowerCase()) ? "critical" : ["warning","warn","medium"].includes(string(value).toLowerCase()) ? "warning" : "info";
const status = (value: unknown): "ok" | "warning" | "violation" | "pending" => ["violation","breach","error","failed"].includes(string(value).toLowerCase()) ? "violation" : ["warning","warn"].includes(string(value).toLowerCase()) ? "warning" : ["pending","processing"].includes(string(value).toLowerCase()) ? "pending" : "ok";
const iso = (value: unknown) => { const date = value ? new Date(String(value)) : new Date(); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); };

function path(source: Record<string, unknown>, ...paths: string[]) {
  for (const candidate of paths) {
    let current: unknown = source;
    for (const key of candidate.split(".")) current = record(current)[key];
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return undefined;
}

function inferType(source: Record<string, unknown>): FleetEventType {
  const raw = string(path(source,"type","eventType","event.type","kind","event.kind","category")).toLowerCase();
  if (/dtc|diagnostic|fault|obd|can_fault/.test(raw) || path(source,"dtc","diagnostic.code","fault.code")) return "diagnostic";
  if (/harsh|speed|idle|driver|behavior|behaviour|seatbelt|phone/.test(raw)) return "behavior";
  if (/camera|video|dashcam|adas|dms/.test(raw)) return "camera";
  if (/charge|charging|evse/.test(raw)) return "charge";
  if (/fuel|tank|refu/.test(raw)) return "fuel";
  if (/etoll|sent|tachograph|tacho|regulatory|compliance/.test(raw)) return "regulatory";
  return "position";
}

function common(source: Record<string, unknown>) {
  return {
    sourceEventId: string(path(source,"id","eventId","event.id","event_id","uuid","sequence")) || crypto.randomUUID(),
    externalDeviceId: string(path(source,"deviceId","device.id","device_id","trackerId","tracker.id","unitId","unit.id","gateway.serial","serialNumber")),
    externalVehicleId: string(path(source,"vehicleId","vehicle.id","vehicle_id","assetId","asset.id","objectId","object.id","vin","registrationNumber","vehicle.registrationNumber")),
    capturedAt: iso(path(source,"capturedAt","timestamp","time","occurredAt","event.timestamp","gps.time","position.time","recordedAt")),
    employeeExternalId: string(path(source,"employeeId","driverId","driver.id","driver.externalId","operatorId")) || undefined
  };
}

export function normalizeFleetTelemetryEvent(providerInput: string, input: unknown): NormalizedFleetEvent {
  const provider = string(providerInput).toLowerCase() as FleetProvider;
  const source = record(input);
  const base = common(source);
  const type = inferType(source);

  if (type === "position") {
    const latitude = finite(path(source,"latitude","lat","gps.latitude","position.latitude","location.latitude","gps.lat","position.lat"));
    const longitude = finite(path(source,"longitude","lng","lon","gps.longitude","position.longitude","location.longitude","gps.lon","position.lon"));
    if (latitude === undefined || longitude === undefined) throw new Error(`Zdarzenie ${provider || "generic"} nie zawiera prawidłowych współrzędnych.`);
    return { type, ...base, position: {
      latitude, longitude,
      speedKph: finite(path(source,"speedKph","speed","gps.speed","position.speed","vehicle.speed")),
      heading: finite(path(source,"heading","course","bearing","gps.heading")),
      altitudeM: finite(path(source,"altitudeM","altitude","gps.altitude")),
      ignition: boolean(path(source,"ignition","engineOn","vehicle.ignition","io.ignition")),
      odometerKm: finite(path(source,"odometerKm","odometer","vehicle.odometer","mileage","totalDistanceKm")),
      engineHours: finite(path(source,"engineHours","engine_hours","vehicle.engineHours","hours")),
      fuelLevelPct: finite(path(source,"fuelLevelPct","fuelLevel","vehicle.fuelLevel","fuel.levelPct")),
      batterySocPct: finite(path(source,"batterySocPct","soc","stateOfCharge","vehicle.batterySoc","ev.soc")),
      batteryVoltage: finite(path(source,"batteryVoltage","vehicle.batteryVoltage","battery.voltage")),
      accuracyM: finite(path(source,"accuracyM","accuracy","gps.accuracy")),
      locationLabel: string(path(source,"locationLabel","address","position.address","location.name")) || undefined
    }, raw: source };
  }

  if (type === "diagnostic") {
    const diagnostic = record(path(source,"diagnostic","fault","dtc"));
    const code = string(path(diagnostic,"code","dtc","faultCode") ?? path(source,"code","dtcCode"));
    if (!code) throw new Error("Zdarzenie diagnostyczne nie zawiera kodu DTC/usterki.");
    const rawState = string(path(diagnostic,"state","status") ?? path(source,"state","status")).toLowerCase();
    return { type, ...base, diagnostic: {
      code,
      system: string(path(diagnostic,"system","module","ecu") ?? path(source,"system","module")) || undefined,
      severity: severity(path(diagnostic,"severity") ?? path(source,"severity")),
      description: string(path(diagnostic,"description","message") ?? path(source,"description","message")) || undefined,
      state: ["cleared","resolved","inactive"].includes(rawState) ? "cleared" : ["historic","history"].includes(rawState) ? "historic" : "active",
      odometerKm: finite(path(source,"odometerKm","odometer","mileage")),
      engineHours: finite(path(source,"engineHours","hours")),
      freezeFrame: record(path(diagnostic,"freezeFrame","freeze_frame","data"))
    }, raw: source };
  }

  if (type === "behavior") {
    const eventType = string(path(source,"eventType","type","event.type","behavior.type","behaviour.type")) || "driver_event";
    const sev = severity(path(source,"severity","event.severity"));
    const penalty: Record<string, number> = { harsh_brake: -4, harsh_acceleration: -3, speeding: -5, phone_use: -9, seatbelt: -10, idling: -2, high_rpm: -2, eco_speed: -1 };
    return { type, ...base, behavior: {
      eventType,
      severity: sev,
      value: finite(path(source,"value","event.value","speed","durationSeconds")),
      unit: string(path(source,"unit","event.unit")) || undefined,
      latitude: finite(path(source,"latitude","lat","location.latitude")),
      longitude: finite(path(source,"longitude","lng","lon","location.longitude")),
      scoreDelta: finite(path(source,"scoreDelta")) ?? penalty[eventType.toLowerCase()] ?? (sev === "critical" ? -8 : sev === "warning" ? -4 : -1),
      metadata: record(path(source,"metadata","event.metadata"))
    }, raw: source };
  }

  if (type === "camera") {
    const eventType = string(path(source,"eventType","type","camera.eventType","event.type")) || "camera_event";
    return { type, ...base, camera: {
      eventType,
      severity: severity(path(source,"severity","camera.severity")),
      aiSummary: string(path(source,"aiSummary","summary","camera.summary")) || undefined,
      aiConfidence: finite(path(source,"aiConfidence","confidence","camera.confidence")),
      mediaUrl: string(path(source,"mediaUrl","videoUrl","imageUrl","camera.mediaUrl")) || undefined,
      metadata: record(path(source,"metadata","camera.metadata"))
    }, raw: source };
  }

  if (type === "charge") {
    return { type, ...base, charge: {
      startedAt: iso(path(source,"startedAt","startTime","charge.startedAt","timestamp")),
      endedAt: path(source,"endedAt","endTime","charge.endedAt") ? iso(path(source,"endedAt","endTime","charge.endedAt")) : undefined,
      location: string(path(source,"location","stationName","charge.location")) || undefined,
      latitude: finite(path(source,"latitude","lat","charge.latitude")), longitude: finite(path(source,"longitude","lng","lon","charge.longitude")),
      energyKwh: finite(path(source,"energyKwh","energy","charge.energyKwh")) ?? 0,
      grossAmount: finite(path(source,"grossAmount","amount","cost","charge.amount")), currency: string(path(source,"currency","charge.currency")) || "PLN",
      startSocPct: finite(path(source,"startSocPct","startSoc","charge.startSoc")), endSocPct: finite(path(source,"endSocPct","endSoc","charge.endSoc")),
      chargerPowerKw: finite(path(source,"chargerPowerKw","powerKw","charge.powerKw")), providerName: string(path(source,"providerName","operator","charge.provider")) || undefined,
      projectExternalId: string(path(source,"projectId","projectExternalId")) || undefined, metadata: record(path(source,"metadata","charge.metadata"))
    }, raw: source };
  }

  if (type === "fuel") {
    return { type, ...base, fuel: {
      fueledAt: iso(path(source,"fueledAt","timestamp","transactionAt")), liters: finite(path(source,"liters","volume","quantity")) ?? 0,
      grossAmount: finite(path(source,"grossAmount","amount","cost")) ?? 0, currency: string(path(source,"currency")) || "PLN",
      mileage: finite(path(source,"mileage","odometerKm","odometer")), fuelType: string(path(source,"fuelType","product")) || undefined,
      stationName: string(path(source,"stationName","station.name","merchant")) || undefined, latitude: finite(path(source,"latitude","lat","station.latitude")), longitude: finite(path(source,"longitude","lng","lon","station.longitude")),
      transactionId: string(path(source,"transactionId","id","eventId")) || base.sourceEventId, projectExternalId: string(path(source,"projectId","projectExternalId")) || undefined,
      employeeExternalId: string(path(source,"employeeId","driverId","driver.id")) || base.employeeExternalId
    }, raw: source };
  }

  return { type: "regulatory", ...base, regulatory: {
    eventType: string(path(source,"eventType","type","category")) || "compliance",
    status: status(path(source,"status","result","severity")), referenceNumber: string(path(source,"referenceNumber","reference","number")) || undefined,
    details: { ...record(path(source,"details","metadata")), provider }
  }, raw: source };
}

export function normalizeFleetTelemetryPayload(provider: string, input: unknown) {
  const source = record(input);
  const candidates = Array.isArray(input) ? input : array(source.events).length ? array(source.events) : array(source.data).length ? array(source.data) : [input];
  return candidates.slice(0, 500).map((item) => normalizeFleetTelemetryEvent(provider, item));
}

export const FLEET_PROVIDER_OPTIONS: Array<{ id: FleetProvider; label: string; capabilities: string[]; note: string }> = [
  { id: "generic", label: "Generic webhook/API", capabilities: ["gps","odometer","fuel","dtc","driver","camera","ev"], note: "Uniwersalny adapter JSON dla własnych urządzeń i pośredników." },
  { id: "webfleet", label: "Webfleet", capabilities: ["gps","driver","fuel","ev","tachograph"], note: "Adapter danych; uruchomienie wymaga dostępu API/Webhook operatora." },
  { id: "geotab", label: "Geotab", capabilities: ["gps","obd","dtc","driver","ev","camera"], note: "Adapter danych; uruchomienie wymaga konta i poświadczeń MyGeotab." },
  { id: "samsara", label: "Samsara", capabilities: ["gps","dtc","driver","camera","ev"], note: "Adapter danych; uruchomienie wymaga konta i tokenu operatora." },
  { id: "motive", label: "Motive", capabilities: ["gps","driver","camera","fuel"], note: "Adapter danych; uruchomienie wymaga dostępu API/Webhook." },
  { id: "cartrack", label: "Cartrack", capabilities: ["gps","driver","fuel"], note: "Adapter dla firm korzystających z Cartrack." },
  { id: "navifleet", label: "Navifleet", capabilities: ["gps","driver","fuel","etoll","sent"], note: "Adapter dla polskich wdrożeń Navifleet." },
  { id: "oem", label: "OEM / producent pojazdu", capabilities: ["gps","odometer","fuel","ev","dtc"], note: "Warstwa integracyjna pod interfejsy producentów pojazdów." },
  { id: "obd", label: "OBD-II", capabilities: ["gps","obd","dtc","odometer","fuel"], note: "Dla urządzeń OBD wysyłających znormalizowany webhook." },
  { id: "can", label: "CAN / FMS", capabilities: ["can","dtc","odometer","engine_hours","fuel"], note: "Dla bramek CAN/FMS i ciężkiego sprzętu." },
  { id: "etoll", label: "e-TOLL", capabilities: ["etoll","gps","compliance"], note: "Warstwa zgodności; transmisja produkcyjna wymaga autoryzowanego źródła danych e-TOLL." },
  { id: "tachograph", label: "Tachograf", capabilities: ["tachograph","driver","compliance"], note: "Import/API pobrań tachografu i kart kierowców." },
  { id: "sent", label: "SENT / PUESC", capabilities: ["sent","gps","compliance"], note: "Warstwa statusów SENT; produkcja wymaga właściwej autoryzacji PUESC/operatora ZSL." },
  { id: "other", label: "Inny dostawca", capabilities: ["custom"], note: "Elastyczny adapter dla dowolnego polskiego lub zagranicznego operatora." }
];
