/** Business content is authoritative even if the first AI category is Fleet.
 * Avoid reprocessing vague text claims without document numbers, KSeF or lines. */
export type BusinessDocumentEvidence = {
  category?: string | null;
  businessDocument?: {
    documentType?: string | null;
    documentNumber?: string | null;
    ksefNumber?: string | null;
    lines?: readonly unknown[] | null;
  } | null;
};

export function needsBusinessDocumentSpecialist(analysis: BusinessDocumentEvidence): boolean {
  if (analysis.category === "invoice" || analysis.category === "warehouse") return true;
  const business = analysis.businessDocument;
  const type = String(business?.documentType ?? "").trim().toLowerCase();
  const supported = ["invoice","receipt","wz","pz","mm","rw","zw","delivery"].includes(type);
  const evidence = Boolean(business?.lines?.length
    || business?.documentNumber?.trim()
    || business?.ksefNumber?.trim());
  return supported && evidence;
}
