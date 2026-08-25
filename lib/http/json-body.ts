const DEFAULT_MAX_JSON_BYTES = 256 * 1024;

export class JsonBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "JsonBodyError";
  }
}

export async function readJsonBody<T>(request: Request, maxBytes = DEFAULT_MAX_JSON_BYTES): Promise<T> {
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new JsonBodyError("Żądanie musi zawierać dane JSON.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new JsonBodyError("Dane żądania są zbyt duże.", 413);
  }

  const raw = await request.text();
  if (!raw.trim()) throw new JsonBodyError("Brakuje danych żądania.", 400);
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new JsonBodyError("Dane żądania są zbyt duże.", 413);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new JsonBodyError("Nieprawidłowe dane JSON.", 400);
  }
}

