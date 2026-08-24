export type ProjectMatchCandidate = {
  id: string;
  name: string;
  code?: string | null;
  status?: string | null;
  description?: string | null;
  investorName?: string | null;
  location?: string | null;
  shortName?: string | null;
  contractNumber?: string | null;
  aliases?: Array<{ value: string; weight?: number }>;
};

export type ProjectMatchEvidence = {
  type: "id" | "contract" | "code" | "short_name" | "name" | "alias" | "investor" | "location" | "tokens";
  value: string;
};

export type ProjectMatchDecision = {
  status: "matched" | "ambiguous" | "no_match" | "general";
  project: ProjectMatchCandidate | null;
  score: number;
  runnerUpScore: number;
  margin: number;
  reason: string;
  evidence: ProjectMatchEvidence[];
  alternatives: Array<{ id: string; name: string; score: number }>;
};

const STOP_WORDS = new Set([
  "dla", "oraz", "przy", "przez", "jest", "ten", "tego", "dokument", "dokumentacja",
  "instalacja", "instalacje", "projekt", "budowa", "roboty", "firma", "spolka"
]);

function normalize(value: string) {
  return value
    .toLocaleLowerCase("pl")
    .replaceAll("ł", "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenList(value: string) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function tokenMatches(left: string, right: string) {
  if (left === right) return true;
  if (left.length >= 5 && right.length >= 5) return left.slice(0, 5) === right.slice(0, 5);
  return false;
}

function containsPhrase(haystack: string, needle: string | null | undefined) {
  const normalizedNeedle = normalize(needle ?? "");
  return normalizedNeedle.length >= 4 && haystack.includes(normalizedNeedle);
}

export function projectCatalogLine(project: ProjectMatchCandidate) {
  return [
    "ID=" + project.id,
    "NAZWA=" + project.name,
    project.shortName ? "SKRÓT=" + project.shortName : null,
    project.contractNumber ? "KONTRAKT=" + project.contractNumber : null,
    project.code ? "KOD=" + project.code : null,
    project.investorName ? "INWESTOR=" + project.investorName : null,
    project.location ? "LOKALIZACJA=" + project.location : null,
    project.aliases?.length ? "ALIASY=" + project.aliases.slice(0, 5).map((alias) => alias.value).join("; ") : null
  ].filter(Boolean).join(" | ");
}

function scoreCandidate(hint: string, project: ProjectMatchCandidate) {
  const normalizedHint = normalize(hint);
  const evidence: ProjectMatchEvidence[] = [];
  let score = 0;

  const normalizedId = normalize(project.id);
  if (normalizedId.length >= 8 && normalizedHint.includes(normalizedId)) {
    return { score: 1, evidence: [{ type: "id", value: project.id }] satisfies ProjectMatchEvidence[] };
  }
  if (containsPhrase(normalizedHint, project.contractNumber)) {
    score = Math.max(score, 0.99);
    evidence.push({ type: "contract", value: project.contractNumber! });
  }
  if (containsPhrase(normalizedHint, project.code)) {
    score = Math.max(score, 0.98);
    evidence.push({ type: "code", value: project.code! });
  }
  if (containsPhrase(normalizedHint, project.shortName)) {
    score = Math.max(score, 0.96);
    evidence.push({ type: "short_name", value: project.shortName! });
  }
  if (containsPhrase(normalizedHint, project.name)) {
    score = Math.max(score, 0.94);
    evidence.push({ type: "name", value: project.name });
  }
  for (const alias of project.aliases ?? []) {
    if (!containsPhrase(normalizedHint, alias.value)) continue;
    const weight = Math.max(0, Math.min(1, alias.weight ?? 1));
    score = Math.max(score, Math.min(0.99, 0.87 + weight * 0.12));
    evidence.push({ type: "alias", value: alias.value });
  }
  if (containsPhrase(normalizedHint, project.investorName)) {
    score = Math.max(score, 0.76);
    evidence.push({ type: "investor", value: project.investorName! });
  }
  if (containsPhrase(normalizedHint, project.location)) {
    score += 0.12;
    evidence.push({ type: "location", value: project.location! });
  }

  const hintTokens = tokenList(hint);
  const candidateText = [
    project.name,
    project.shortName,
    project.contractNumber,
    project.code,
    project.investorName,
    project.location,
    project.description,
    ...(project.aliases ?? []).map((alias) => alias.value)
  ].filter(Boolean).join(" ");
  const candidateTokens = tokenList(candidateText);
  const shared = hintTokens.filter((hintToken) => candidateTokens.some((candidateToken) => tokenMatches(hintToken, candidateToken)));
  if (shared.length >= 2) {
    const hintCoverage = shared.length / Math.max(1, hintTokens.length);
    const candidateCoverage = shared.length / Math.max(3, candidateTokens.length);
    const tokenScore = Math.min(0.9, hintCoverage * 0.62 + candidateCoverage * 0.28);
    score = Math.max(score, tokenScore);
    evidence.push({ type: "tokens", value: shared.slice(0, 8).join(", ") });
  }

  return { score: Math.min(1, score), evidence };
}

export function evaluateProjectMatch(hint: string, projects: ProjectMatchCandidate[]): ProjectMatchDecision {
  const normalizedHint = normalize(hint);
  if (!normalizedHint || normalizedHint === "ogolne" || normalizedHint.includes("brak dopasowania")) {
    return {
      status: "general",
      project: null,
      score: 0,
      runnerUpScore: 0,
      margin: 0,
      reason: "Dokument został oznaczony jako ogólnofirmowy lub nie zawiera wskazania inwestycji.",
      evidence: [],
      alternatives: []
    };
  }

  const ranked = projects
    .map((project) => ({ project, ...scoreCandidate(hint, project) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUpScore = ranked[1]?.score ?? 0;
  const margin = Math.max(0, (best?.score ?? 0) - runnerUpScore);
  const alternatives = ranked.slice(0, 3).map((item) => ({ id: item.project.id, name: item.project.name, score: item.score }));

  if (!best || best.score < 0.68) {
    return {
      status: "no_match",
      project: null,
      score: best?.score ?? 0,
      runnerUpScore,
      margin,
      reason: "Brak wystarczająco mocnych danych do bezpiecznego przypisania inwestycji.",
      evidence: best?.evidence ?? [],
      alternatives
    };
  }

  const hasExactEvidence = best.evidence.some((item) => ["id", "contract", "code", "short_name", "name", "alias"].includes(item.type));
  if (!hasExactEvidence && margin < 0.12) {
    return {
      status: "ambiguous",
      project: null,
      score: best.score,
      runnerUpScore,
      margin,
      reason: "Co najmniej dwie inwestycje pasują podobnie. Wymagany jest wybór użytkownika.",
      evidence: best.evidence,
      alternatives
    };
  }

  return {
    status: "matched",
    project: best.project,
    score: best.score,
    runnerUpScore,
    margin,
    reason: hasExactEvidence
      ? "Dopasowanie opiera się na jednoznacznym identyfikatorze lub nazwie."
      : "Dopasowanie przekroczyło próg pewności i ma bezpieczną przewagę nad alternatywami.",
    evidence: best.evidence,
    alternatives
  };
}

export function matchProjectHint(hint: string, projects: ProjectMatchCandidate[]) {
  const decision = evaluateProjectMatch(hint, projects);
  if (decision.status !== "matched" || !decision.project) return null;
  return {
    project: decision.project,
    score: decision.score,
    runnerUpScore: decision.runnerUpScore,
    margin: decision.margin,
    reason: decision.reason,
    evidence: decision.evidence
  };
}
