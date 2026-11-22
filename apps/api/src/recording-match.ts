/** Identity fields supplied by the metadata catalog and the audio catalog. */
export type RecordingIdentity = {
  artist?: string | null;
  title?: string | null;
  isrc?: string | null;
  durationSeconds?: number | null;
};

export type RecordingMatch = "isrc" | "meta+duration" | "artist+title";

const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export function validIsrc(value: unknown): string | null {
  const text = typeof value === "string" ? value.toUpperCase().replace(/[\s-]/g, "") : "";
  return ISRC_PATTERN.test(text) ? text : null;
}

export function recordingTextKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/ё/g, "е").normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

const LABEL = "official (?:audio|video)|lyric video";
const DELIVERY_LABEL = new RegExp(`\\s*(?:\\((?:${LABEL})\\)|\\[(?:${LABEL})\\]|[–—-]\\s*(?:${LABEL}))\\s*$`, "iu");

export function recordingTitleKey(value: string | null | undefined): string {
  // Delivery labels do not describe the recording. Keep other qualifiers,
  // including edit, remix, remaster, cover, and named alternate takes.
  return recordingTextKey((value ?? "").replace(DELIVERY_LABEL, ""));
}

function duration(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Evidence required to select a stream automatically from a permitted catalog. */
export function matchRecording(wanted: RecordingIdentity, candidate: RecordingIdentity): RecordingMatch | null {
  const wantedIsrc = validIsrc(wanted.isrc);
  const haveIsrc = validIsrc(candidate.isrc);
  const wantedDuration = duration(wanted.durationSeconds);
  const haveDuration = duration(candidate.durationSeconds);
  if (wantedDuration !== null && haveDuration !== null && Math.abs(wantedDuration - haveDuration) > 10) return null;
  if (wantedIsrc && haveIsrc) return wantedIsrc === haveIsrc ? "isrc" : null;

  const artist = recordingTextKey(wanted.artist);
  const title = recordingTitleKey(wanted.title);
  if (!artist || artist === "unknown artist" || !title || artist !== recordingTextKey(candidate.artist) || title !== recordingTitleKey(candidate.title)) return null;
  if (wantedDuration !== null && haveDuration === null) return null;
  return wantedDuration === null ? "artist+title" : "meta+duration";
}
