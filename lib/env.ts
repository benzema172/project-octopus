export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing environment variable: ${name}`);
    this.name = "MissingEnvError";
  }
}

export function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export function requireServerEnv(name: string): string {
  const value = getOptionalEnv(name);

  if (!value) {
    throw new MissingEnvError(name);
  }

  return value;
}

export function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return null;
  }

  return {
    url,
    publishableKey
  };
}

export function getR2Config() {
  const accountId = getOptionalEnv("R2_ACCOUNT_ID");
  const endpoint = getOptionalEnv("R2_ENDPOINT") ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  if (!endpoint) {
    throw new MissingEnvError("R2_ENDPOINT");
  }

  return {
    endpoint,
    bucketName: requireServerEnv("R2_BUCKET_NAME"),
    accessKeyId: requireServerEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireServerEnv("R2_SECRET_ACCESS_KEY")
  };
}

export function getAiRuntimeStatus() {
  const provider = getOptionalEnv("AI_PROVIDER") ?? "gemini";

  return {
    provider,
    geminiConfigured: Boolean(getOptionalEnv("GEMINI_API_KEY")),
    ready: provider === "gemini" && Boolean(getOptionalEnv("GEMINI_API_KEY"))
  };
}
