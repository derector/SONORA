export type CatalogCandidate = { title?: string; artist?: string | string[]; durationMs?: number | null; isrc?: string | null; provider?: string; [key: string]: unknown; };
export type CatalogGroup<T extends CatalogCandidate> = { primary: T; matches: T[] };

export function normalizeCatalogText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/ё/g, "е").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function normalizeIsrc(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toUpperCase() : "";
}
function artistKey(value: CatalogCandidate["artist"]): string {
  const names = Array.isArray(value) ? value : [value];
  return names.map(normalizeCatalogText).filter(Boolean).sort().join("|");
}
function durationCompatible(a: CatalogCandidate, b: CatalogCandidate, toleranceMs: number): boolean {
  return typeof a.durationMs !== "number" || typeof b.durationMs !== "number" || Math.abs(a.durationMs - b.durationMs) <= toleranceMs;
}
export function deduplicateCatalog<T extends CatalogCandidate>(candidates: T[], durationToleranceMs = 8000): CatalogGroup<T>[] {
  const groups: CatalogGroup<T>[] = [];
  for (const candidate of candidates) {
    const isrc = normalizeIsrc(candidate.isrc);
    const title = normalizeCatalogText(candidate.title);
    const artist = artistKey(candidate.artist);
    let match: CatalogGroup<T> | undefined;
    for (const group of groups) {
      const entries = [group.primary, ...group.matches];
      match = entries.some((item) => {
        const otherIsrc = normalizeIsrc(item.isrc);
        if (isrc && otherIsrc) return isrc === otherIsrc;
        return !!title && title === normalizeCatalogText(item.title) && !!artist && artist === artistKey(item.artist) && durationCompatible(candidate, item, durationToleranceMs);
      }) ? group : undefined;
      if (match) break;
    }
    if (match) match.matches.push(candidate);
    else groups.push({ primary: candidate, matches: [] });
  }
  return groups;
}
