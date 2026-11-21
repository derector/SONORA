export type CatalogCandidate = {
  id?: string;
  title?: string;
  artist?: string | string[];
  durationMs?: number | null;
  isrc?: string | null;
  provider?: string;
  url?: string | null;
  [key: string]: unknown;
};

export type CatalogGroup<T extends CatalogCandidate> = {
  primary: T;
  matches: T[];
};

/** Normalize text for conservative catalog matching, including Russian ё/е. */
export function normalizeCatalogText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeIsrc(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toUpperCase() : "";
}

function artistKey(value: CatalogCandidate["artist"]): string {
  const names = Array.isArray(value) ? value : [value];
  return names.map(normalizeCatalogText).filter(Boolean).sort().join("|");
}

function titleKey(value: unknown): string {
  return normalizeCatalogText(value);
}

function durationCompatible(a: CatalogCandidate, b: CatalogCandidate, toleranceMs: number): boolean {
  const x = a.durationMs;
  const y = b.durationMs;
  // If either provider omits duration, do not block a title+artist match.
  return typeof x !== "number" || typeof y !== "number" || Math.abs(x - y) <= toleranceMs;
}

/**
 * Groups catalog results without fuzzy title matching.
 * ISRC is authoritative when both candidates have one; otherwise exact normalized
 * artist/title plus a duration guard is required to avoid merging lookalikes.
 */
export function deduplicateCatalog<T extends CatalogCandidate>(
  candidates: T[],
  durationToleranceMs = 8000
): CatalogGroup<T>[] {
  const groups: CatalogGroup<T>[] = [];

  for (const candidate of candidates) {
    const candidateIsrc = normalizeIsrc(candidate.isrc);
    const candidateTitle = titleKey(candidate.title);
    const candidateArtist = artistKey(candidate.artist);
    let found: CatalogGroup<T> | undefined;

    for (const group of groups) {
      const existing = [group.primary, ...group.matches];
      found = existing.some((item) => {
        const itemIsrc = normalizeIsrc(item.isrc);
        if (candidateIsrc && itemIsrc) return candidateIsrc === itemIsrc;
        // Conflicting ISRCs are a strong signal that these are distinct recordings.
        if (candidateIsrc && itemIsrc && candidateIsrc !== itemIsrc) return false;
        return candidateTitle !== "" &&
          candidateTitle === titleKey(item.title) &&
          candidateArtist !== "" &&
          candidateArtist === artistKey(item.artist) &&
          durationCompatible(candidate, item, durationToleranceMs);
      }) ? group : undefined;
      if (found) break;
    }

    if (found) found.matches.push(candidate);
    else groups.push({ primary: candidate, matches: [] });
  }

  return groups;
}
