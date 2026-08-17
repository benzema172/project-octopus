export type MatchCandidate = { id: string; label: string; context?: string | null };
export type RankedMatch = MatchCandidate & { score: number; reasons: string[] };

const STOP = new Set(["oraz","dla","przez","zestaw","szt","sztuka","instalacja","instalacji","material","materialu","rura","element"]);
export function normalizeMatchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.,/-]+/g, " ").trim();
}
function words(value: string) { return normalizeMatchText(value).split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)); }
function numbers(value: string) { return normalizeMatchText(value).match(/\d+(?:[.,]\d+)?/g) ?? []; }

export function matchScore(source: string, candidate: string) {
  const sourceWords = new Set(words(source));
  const candidateWords = new Set(words(candidate));
  if (!sourceWords.size || !candidateWords.size) return { score: 0, reasons: [] as string[] };
  const shared = [...sourceWords].filter((word) => candidateWords.has(word));
  const sourceNumbers = new Set(numbers(source));
  const candidateNumbers = new Set(numbers(candidate));
  const sharedNumbers = [...sourceNumbers].filter((value) => candidateNumbers.has(value));
  const coverage = shared.length / sourceWords.size;
  const precision = shared.length / candidateWords.size;
  const numericBonus = sharedNumbers.length ? Math.min(0.25, sharedNumbers.length * 0.1) : 0;
  const phraseBonus = normalizeMatchText(candidate).includes(normalizeMatchText(source)) || normalizeMatchText(source).includes(normalizeMatchText(candidate)) ? 0.2 : 0;
  const score = Math.min(1, coverage * 0.62 + precision * 0.18 + numericBonus + phraseBonus);
  const reasons = [...shared.slice(0, 5).map((word) => `wspólne: ${word}`), ...sharedNumbers.slice(0, 3).map((value) => `parametr: ${value}`)];
  return { score, reasons };
}

export function rankMatches(source: string, candidates: MatchCandidate[], limit = 3): RankedMatch[] {
  return candidates.map((candidate) => {
    const match = matchScore(source, `${candidate.label} ${candidate.context ?? ""}`);
    return { ...candidate, ...match };
  }).filter((candidate) => candidate.score >= 0.12).sort((a,b) => b.score-a.score).slice(0, limit);
}
