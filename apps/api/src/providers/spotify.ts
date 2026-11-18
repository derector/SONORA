type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  explicit?: boolean;
  external_urls?: { spotify?: string };
  album?: { name?: string; images?: Array<{ url?: string }> };
  artists?: Array<{ name?: string }>;
  external_ids?: { isrc?: string };
  uri?: string;
};

type SpotifySearchResponse = { tracks?: { items?: SpotifyTrack[] } };

export type SpotifySearchRecord = {
  id: string;
  provider: "Spotify";
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
  artworkUrl: string | null;
  sourceUrl: string;
  spotifyUri: string | null;
  isrc: string | null;
  playable: false;
  metadataOnly: true;
};

let tokenCache: string | null = null;
let tokenExpiry = 0;

async function accessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Spotify API credentials are not configured.");
  if (tokenCache && Date.now() < tokenExpiry - 60000) return tokenCache;

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`Spotify token request failed (HTTP ${response.status}).`);
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!result.access_token) throw new Error("Spotify returned no access token.");
  tokenCache = result.access_token;
  tokenExpiry = Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000;
  return tokenCache;
}

export async function searchSpotifyTracks(query: string, limit = 10): Promise<SpotifySearchRecord[]> {
  const token = await accessToken();
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(Math.min(10, Math.max(1, limit))),
    market: process.env.SPOTIFY_MARKET ?? "DE"
  });
  const response = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) {
    if (response.status === 401) {
      tokenCache = null;
      tokenExpiry = 0;
    }
    throw new Error(`Spotify search failed (HTTP ${response.status}).`);
  }
  const payload = await response.json() as SpotifySearchResponse;
  return (payload.tracks?.items ?? []).flatMap((track) => {
    if (!track.id || !track.name) return [];
    return [{
      id: `spotify:${track.id}`,
      provider: "Spotify" as const,
      title: track.name,
      artist: (track.artists ?? []).map((a) => a.name ?? "").filter(Boolean).join(", ") || "Unknown artist",
      album: track.album?.name ?? null,
      durationSeconds: Math.round((track.duration_ms ?? 0) / 1000),
      artworkUrl: track.album?.images?.[0]?.url ?? null,
      sourceUrl: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
      spotifyUri: track.uri ?? null,
      isrc: track.external_ids?.isrc ?? null,
      playable: false as const,
      metadataOnly: true as const
    }];
  });
}
