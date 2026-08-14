export type ProjectMatchCandidate = {
  id: string;
  name: string;
  investorName?: string | null;
  location?: string | null;
};

function normalize(value: string) {
  return value
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 3));
}

export function projectCatalogLine(project: ProjectMatchCandidate) {
  return [project.id, project.name, project.investorName, project.location].filter(Boolean).join(" | ");
}

export function matchProjectHint(hint: string, projects: ProjectMatchCandidate[]) {
  const normalizedHint = normalize(hint);
  if (!normalizedHint || normalizedHint === "ogolne" || normalizedHint.includes("brak dopasowania")) return null;
  const hintTokens = tokens(hint);
  let best: { project: ProjectMatchCandidate; score: number } | null = null;

  for (const project of projects) {
    const searchable = projectCatalogLine(project);
    const normalizedSearchable = normalize(searchable);
    let score = 0;
    if (normalizedHint.includes(normalize(project.id))) score = 1;
    else if (normalizedHint.includes(normalize(project.name)) || normalizedSearchable.includes(normalizedHint)) score = 0.94;
    else {
      const projectTokens = tokens(searchable);
      const shared = [...hintTokens].filter((token) => projectTokens.has(token)).length;
      score = shared / Math.max(3, Math.min(hintTokens.size || 1, projectTokens.size || 1));
    }
    if (!best || score > best.score) best = { project, score };
  }

  return best && best.score >= 0.5 ? best : null;
}
